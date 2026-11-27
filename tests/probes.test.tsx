import { expect, test } from 'claude-code/testing'
import { parseCodexTail } from '../hooks/codex'
import { parseProcessMemory, parseWinSys } from '../hooks/lib/probe'

test('Codex reads cumulative tokens and both reset formats across broken lines', () => {
  const timestamp = '2026-11-26T19:00:00Z'
  const at = Date.parse(timestamp)
  const event = (fields: object) => JSON.stringify({
    timestamp, type: 'event_msg', payload: { type: 'token_count', ...fields },
  })
  const result = parseCodexTail([
    '"truncated": true}',
    JSON.stringify({ timestamp, type: 'turn_context', payload: { model: 'gpt-5.4' } }),
    event({ info: { total_token_usage: { total_tokens: 100, cached_input_tokens: 60 } } }),
    'null',
    event({ info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 25, reasoning_output_tokens: 10 } } }),
    event({ info: null, rate_limits: {
      plan_type: 'plus',
      primary: { used_percent: 0, window_minutes: 10080, resets_in_seconds: 120 },
      secondary: { used_percent: 1, window_minutes: 300, resets_at: at / 1000 + 60 },
      other: { used_percent: 50, window_minutes: 60 },
    } }),
    '{"incomplete":',
  ].join('\n'))
  expect(result).toEqual({
    total: 125,
    at,
    model: { value: 'gpt-5.4', at },
    plan: { value: 'plus', at },
    tokens: { input: 100, cached: 60, output: 25 },
    limits: { five: { used: 1, at, resetsAt: at + 60_000 }, week: { used: 0, at, resetsAt: at + 120_000 } },
  })
  expect(parseCodexTail('broken\n{')).toEqual({ limits: {} })
})

test('Windows separates RAM and process working sets and omits empty groups', () => {
  const sys = parseWinSys('{"cpu":23,"total":1048576,"free":104857,"claudeCount":1,"claudeBytes":67108864,"codexCount":0,"codexBytes":null}')
  expect(sys).toEqual({ cpu: 23, memUsed: 966368256, memTotal: 1073741824, claude: { count: 1, bytes: 67108864 } })
  expect(parseWinSys('invalid')).toEqual({})
})

test('POSIX sums resident memory for Claude and Codex processes', () => {
  expect(parseProcessMemory('64 /usr/bin/claude\n10 codex\n20 Codex Helper\n90 node\n')).toEqual({
    claude: { count: 1, bytes: 65536 },
    codex: { count: 2, bytes: 30720 },
  })
})