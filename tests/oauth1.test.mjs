import { signOAuth1, signatureBaseString } from '../extension/lib/broadcast/x.js'

// X publishes a worked example of OAuth 1.0a signing with a known-good
// signature. Hand-rolled crypto is untestable against a live account without
// paying per post, so this pins it to their own vector instead.
// https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature

const creds = {
  apiKey: 'xvz1evFS4wEEPTGEFPHBog',
  apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
  accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
  accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
}

const EXPECTED_BASE =
  'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521'

const EXPECTED_SIGNATURE = 'hCtSmYh+iHYCEqBWrE7C7hYmtUk='

let pass = 0
let fail = 0
const check = (name, actual, expected) => {
  if (actual === expected) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}`)
    console.log(`        expected: ${expected}`)
    console.log(`        actual:   ${actual}`)
  }
}

console.log("\nOAuth 1.0a signing vs X's published vector\n")

const url = 'https://api.twitter.com/1.1/statuses/update.json'
const extraParams = {
  status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
  include_entities: 'true',
}
const oauthParams = { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958 }

const base = signatureBaseString('POST', url, {
  oauth_consumer_key: creds.apiKey,
  oauth_nonce: oauthParams.nonce,
  oauth_signature_method: 'HMAC-SHA1',
  oauth_timestamp: String(oauthParams.timestamp),
  oauth_token: creds.accessToken,
  oauth_version: '1.0',
  ...extraParams,
})
check('signature base string', base, EXPECTED_BASE)

const { signature, header } = await signOAuth1({ method: 'POST', url, creds, oauthParams, extraParams })
check('HMAC-SHA1 signature', signature, EXPECTED_SIGNATURE)

check(
  'authorization header carries the signature',
  header.includes(`oauth_signature="${encodeURIComponent(EXPECTED_SIGNATURE).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}"`),
  true
)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
