// 27 Nov 2026 (owner): the per-image 'AI-styled image' label is gone. One footer line says it for the whole site;
// the ai_image / photos[].ai DATA flags stay (tests/*gallery*, gen-cards-photos).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const HTML = read('../index.html'), SF = read('../js/storefront.js')
const NOTE = '<p class="ai-note">Some images on this site are created or styled with AI technology.</p>'

test('index.html: the AI note appears exactly once, inside <footer>', () => {
  assert.equal(HTML.split(NOTE).length - 1, 1)
  assert.equal((HTML.match(/class="ai-note"/g) || []).length, 1)
  const foot = HTML.match(/<footer[\s\S]*?<\/footer>/g) || []
  assert.equal(foot.filter((f) => f.includes(NOTE)).length, 1, 'the note sits in one <footer>')
})

test('no render code produces the per-image label (index.html, js/storefront.js; code lines only)', () => {
  const code = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n')
  for (const [n, s] of [['index.html', HTML], ['js/storefront.js', SF]]) {
    // grep on every line that is not a pure comment line: neither the label text nor the label element may be emitted
    assert.doesNotMatch(code(s), /AI-styled image/, n + ': no label text in code')
    assert.doesNotMatch(code(s), /<small class="kl-ai|className\s*=\s*'kl-ai|createElement\('small'\)[^;]*kl-ai/, n + ': no label element')
  }
})
