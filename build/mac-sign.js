// Signs the packaged app with the certificate named by SHA-1 rather than by name.
//
// electron-builder resolves `mac.identity` to a certificate object and then
// passes only its *name* to @electron/osx-sign (macPackager.js `doSign`), which
// hands it to `codesign --sign`. This keychain holds two distinct, both-valid
// "Developer ID Application: Steve Villardi (VZ5TTKF948)" certificates, so that
// name is ambiguous and codesign refuses:
//
//   Developer ID Application: ...: ambiguous (matches "..." and "..." in login.keychain-db)
//
// osx-sign itself prefers a hash when it has one (`identity.hash || identity.name`),
// and its findIdentities() matches any `security find-identity -v` line that
// *contains* the string it is given -- so handing it the SHA-1 selects exactly one
// line and yields an unambiguous `--sign <hash>`. This hook is the documented
// `mac.sign` escape, and it leaves the developer's keychain alone: cleaning up the
// duplicate certificate would work too, but a build must not depend on that.
const { readFileSync } = require('fs')
const { join } = require('path')

// electron-builder.yml is the single source of truth for which certificate;
// scripts/sign-dev-electron.sh reads the same line for the dev binary.
function identityHash() {
  const yml = readFileSync(join(__dirname, '..', 'electron-builder.yml'), 'utf8')
  const match = /^ {2}identity: ([0-9A-Fa-f]{40})$/m.exec(yml)
  if (!match) throw new Error('mac-sign: no 40-char identity hash in electron-builder.yml')
  return match[1]
}

exports.default = async function sign(opts) {
  const { signAsync } = require('@electron/osx-sign')
  await signAsync({ ...opts, identity: identityHash() })
}
