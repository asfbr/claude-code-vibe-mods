import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// The engine beneath the row under the prompt: its hint, then the `tail` a hook set, as the terminal draws it.
export const engineHint = (on: On) => on('ui.render', { component: 'PromptHint' }, ($, e) => {
  const { Text } = $.ui.resolve(e)
  return <Text dimColor>{[e.props.hint, e.props.tail ?? ''].filter(s => s !== '').join(' · ')}</Text>
})

// What that row shows now, its texts joined, and each text's colour.
export const hintRow = async ($: Engine, hint = '') => {
  const ui = await $.ui.mount({ plugin: 'announcer', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint } })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return { text: texts.map(t => t.text).join(''), colors: texts.map(t => t.props.color).filter(c => c !== undefined) }
}
export const hintLine = async ($: Engine, hint = '') => (await hintRow($, hint)).text

// The band above the prompt, where cues draw; the engine beneath draws nothing there of its own.
export const engineBand = (on: On) => on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
  const { Box } = $.ui.resolve(e)
  return <Box />
})
export const bandRow = async ($: Engine, hasSurvey = false) => {
  const props = { hasSurvey, isWorking: false, maxRows: 10, bodyColumns: 100 } as never // the scroll/view props are the engine's
  const ui = await $.ui.mount({ plugin: 'announcer', surface: 'terminal', component: 'AbovePrompt', props })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return { text: texts.map(t => t.text).join(''), colors: texts.map(t => t.props.color).filter(c => c !== undefined) }
}
export const bandLine = async ($: Engine, hasSurvey = false) => (await bandRow($, hasSurvey)).text
