"""Build sounds/<theme>/*.wav: fetch each game's package, pull the named clips, write them small.

python scripts/sounds.py <cache dir>   (downloads land in the cache dir, kept for the next run)
Small = 11025 Hz 8-bit mono, peak-normalised, silence trimmed: ~11 KB a second.
Reads UE1/UE2 .uax (UT99 v68, UT2004 v120-126; .uz2 is zlib chunks of [csize][usize][data]) and
the Quake III demo's pak0.pk3 (a zip, inside a makeself .gz.sh). Stdlib only.
"""
import array, io, math, os, struct, sys, tarfile, urllib.request, wave, zipfile, zlib

UT99 = 'https://archive.org/download/ut-goty/UT_GOTY_CD1.iso/Sounds%2F'
UT2004 = 'https://archive.org/download/ut-2004-dvd/UT2004_DVD.ISO/CD2%2FSounds%2F'
Q3DEMO = 'https://ftp.gwdg.de/pub/misc/ftp.idsoftware.com/idstuff/quake3/linux/linuxq3ademo-1.11-6.x86.gz.sh'

# theme -> (source url, {our clip id: name in the package}); the ids are the clips themes/index.ts names.
SOURCES = {
    'ut99': (UT99 + 'Announcer.uax', {n: n for n in (
        'firstblood killingspree rampage dominating unstoppable godlike headshot doublekill triplekill '
        'multikill megakill ultrakill monsterkill nicecatch takenlead assist winner').split()}),
    'xan': (UT99 + 'BossVoice.uax', {n: 'B' + n for n in (
        'next boom superior perfection eliminated obsolete useless stepaside bowdown fearme inferior '
        'myhouse hadtohurt burnbaby').split()}),
    'ut2003': (UT2004 + 'AnnouncerMain.uax.uz2', {
        'firstblood': 'first_blood', 'killingspree': 'killing_spree', 'rampage': 'rampage',
        'dominating': 'dominating', 'unstoppable': 'unstoppable', 'godlike': 'godlike', 'wickedsick': 'WhickedSick',
        'headshot': 'headshot', 'doublekill': 'double_kill', 'triplekill': 'triple_kill', 'multikill': 'multikill',
        'megakill': 'megakill', 'ultrakill': 'ultrakill', 'monsterkill': 'Monsterkill_F',
        'ludicrouskill': 'LudicrousKill_F', 'holyshit': 'HolyShit_F', 'flawless': 'Flawless_victory',
        'hattrick': 'Hattrick', 'lastsecondsave': 'Last_Second_Save', 'averted': 'Narrowly_Averted',
        'wonmatch': 'You_have_won_the_match', 'brutalmatch': 'That_was_one_brutal_match'}),
    'ut2004-female': (UT2004 + 'announcerfemale2k4.uax.uz2', {
        'firstblood': 'first_blood', 'killingspree': 'Killing_Spree', 'rampage': 'Rampage',
        'dominating': 'Dominating', 'unstoppable': 'Unstoppable', 'godlike': 'GodLike', 'wickedsick': 'WhickedSick',
        'headshot': 'Headshot', 'doublekill': 'Double_Kill', 'multikill': 'MultiKill', 'megakill': 'MegaKill',
        'monsterkill': 'MonsterKill', 'ludicrouskill': 'LudicrousKill', 'holyshit': 'HolyShit',
        'flawless': 'Flawless_victory', 'hattrick': 'HatTrick', 'denied': 'Denied', 'eagleeye': 'EagleEye',
        'topgun': 'Top_Gun', 'pancake': 'Pancake', 'lastsecondsave': 'Last_Second_Save',
        'wonmatch': 'You_Have_Won_the_Match'}),
    'quake3': (Q3DEMO, {**{n: f'sound/feedback/{n}.wav' for n in (
        'excellent impressive perfect accuracy denied humiliation takenlead').split()},
        'youwin': 'sound/player/announce/youwin.wav'}),
}

def ci(b, p):  # UE compact index
    x = b[p]; p += 1; neg = x & 0x80; v = x & 0x3F
    if x & 0x40:
        sh = 6
        while True:
            x = b[p]; p += 1; v |= (x & 0x7F) << sh; sh += 7
            if not x & 0x80: break
    return (-v if neg else v), p

def unz2(raw):
    out, p = bytearray(), 0
    while p < len(raw):
        cs, _ = struct.unpack_from('<II', raw, p); p += 8
        out += zlib.decompress(raw[p:p + cs]); p += cs
    return bytes(out)

def uax(b):  # {export name: the RIFF bytes inside it}
    tag, ver, lic, flags, nc, no, ec, eo = struct.unpack_from('<IHHIIIII', b, 0)
    assert tag == 0x9E2A83C1, 'not a UE package'
    names, p = [], no
    for _ in range(nc):
        n, p = ci(b, p); names.append(b[p:p + n].rstrip(b'\0').decode('latin1')); p += n + 4
    found, p = {}, eo
    for _ in range(ec):
        _, p = ci(b, p); _, p = ci(b, p); p += 4
        nm, p = ci(b, p); p += 4
        size, p = ci(b, p); off = 0
        if size > 0: off, p = ci(b, p)
        blob = b[off:off + size]; r = blob.find(b'RIFF')
        if r >= 0 and blob[r + 8:r + 12] == b'WAVE':
            found[names[nm]] = blob[r:r + struct.unpack_from('<I', blob, r + 4)[0] + 8]
    return found

def pk3(b):  # the makeself script's tar.gz -> demoq3/pak0.pk3 -> {path: bytes}
    t = tarfile.open(fileobj=io.BytesIO(b[b.find(b'\x1f\x8b\x08'):]), mode='r:gz')
    z = zipfile.ZipFile(io.BytesIO(t.extractfile(next(m for m in t.getmembers() if m.name.endswith('pak0.pk3'))).read()))
    return {n: z.read(n) for n in z.namelist() if n.endswith('.wav')}

RATE = 11025

def resample(x, rate):  # band-limited: a Hann-windowed sinc at 0.45 of the new rate, read at each output instant
    if rate == RATE: return x
    step, f = rate / RATE, 0.45 * RATE / rate; half = round(16 * step); n = len(x)
    kern = lambda d: 2 * f * (1 if d == 0 else math.sin(2 * math.pi * f * d) / (2 * math.pi * f * d)) * (0.5 + 0.5 * math.cos(math.pi * d / (half + 1)))
    out = []
    for i in range(int(n / step)):
        t = i * step; c = int(t)
        out.append(sum(x[k] * kern(t - k) for k in range(max(0, c - half), min(n, c + half + 1))))
    return out

def shrink(riff):
    w = wave.open(io.BytesIO(riff)); rate, width, ch = w.getframerate(), w.getsampwidth(), w.getnchannels()
    raw = w.readframes(w.getnframes())
    x = [s - 128 for s in raw] if width == 1 else list(array.array('h', raw))
    x = resample(x[::ch], rate)  # first channel
    peak = max(map(abs, x)) or 1
    loud = [i for i, s in enumerate(x) if abs(s) > 0.02 * peak]
    a, z = max(0, loud[0] - 220), min(len(x), loud[-1] + 660)  # 20 ms lead-in, 60 ms tail
    x = x[a:z]; fade = 330
    for i in range(min(fade, len(x))): x[-1 - i] *= i / fade
    out = bytes(max(0, min(255, round(s * 121 / peak) + 128)) for s in x)
    buf = io.BytesIO(); o = wave.open(buf, 'wb'); o.setnchannels(1); o.setsampwidth(1); o.setframerate(RATE)
    o.writeframes(out); o.close(); return buf.getvalue()

def fetch(url, cache):
    path = os.path.join(cache, url.rsplit('/', 1)[1].replace('%2F', '_'))
    if not os.path.exists(path): print('fetching', url); urllib.request.urlretrieve(url, path)
    return open(path, 'rb').read()

if __name__ == '__main__':
    cache = sys.argv[1]; os.makedirs(cache, exist_ok=True)
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds')
    for theme, (url, clips) in SOURCES.items():
        b = fetch(url, cache)
        found = pk3(b) if url.endswith('.gz.sh') else uax(unz2(b) if url.endswith('.uz2') else b)
        out = os.path.join(root, theme); os.makedirs(out, exist_ok=True)
        for f in os.listdir(out): os.remove(os.path.join(out, f))
        total = 0
        for clip, name in clips.items():
            data = shrink(found[name]); total += len(data)
            open(os.path.join(out, clip + '.wav'), 'wb').write(data)
        print(f'{theme}: {len(clips)} clips, {total // 1024} KB')
