import { byline, profileUrl } from '../extension/lib/format.js'

let pass = 0
let fail = 0
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}`) } else { fail++; console.log(`  FAIL  ${n} ${d}`) }
}

console.log('\nThe fomo handle and its profile link\n')

check('handle renders with @', byline({ fomoUsername: 'Hiraethh' }) === '@Hiraethh')
check('a leading @ is not doubled', byline({ fomoUsername: '@Hiraethh' }) === '@Hiraethh')
check('whitespace is trimmed', byline({ fomoUsername: '  Hiraethh ' }) === '@Hiraethh')
check('no handle, no byline', byline({ fomoUsername: '' }) === '')
check('missing setting is fine', byline({}) === '')

check(
  'profile url matches fomo.family/profile/<handle>',
  profileUrl({ fomoUsername: 'Hiraethh' }) === 'https://fomo.family/profile/Hiraethh'
)
check('the @ is stripped from the url', profileUrl({ fomoUsername: '@Hiraethh' }) === 'https://fomo.family/profile/Hiraethh')
check('no handle, no url', profileUrl({ fomoUsername: '' }) === '')

// A handle goes straight into a URL, so anything odd must be encoded rather
// than breaking the link or smuggling in a path.
check(
  'a handle with a slash cannot escape the path',
  profileUrl({ fomoUsername: 'a/b' }) === 'https://fomo.family/profile/a%2Fb'
)
check(
  'spaces are encoded',
  profileUrl({ fomoUsername: 'two words' }) === 'https://fomo.family/profile/two%20words'
)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
