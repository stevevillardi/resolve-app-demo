import { describe, expect, it } from 'vitest'
import { ipcErrorMessage } from './ipc-client'

/**
 * Main writes error messages meant for the user to read — "Can't delete this
 * persona — 2 contacts still bound to it: …". Electron wraps them on the way
 * across, so without this the UI would print the transport's plumbing.
 */

describe('ipcErrorMessage', () => {
  it('unwraps the Electron invoke wrapper', () => {
    const error = new Error(
      "Error invoking remote method 'ipc-invoke': Error: Can't delete this persona — 1 contact still bound to it: Code Reviewer · app. Delete those first."
    )
    expect(ipcErrorMessage(error)).toBe(
      "Can't delete this persona — 1 contact still bound to it: Code Reviewer · app. Delete those first."
    )
  })

  it('leaves an already-plain message alone', () => {
    expect(ipcErrorMessage(new Error('Network unreachable'))).toBe('Network unreachable')
  })

  it('strips a bare error-class prefix', () => {
    expect(ipcErrorMessage(new Error('TypeError: x is not a function'))).toBe('x is not a function')
  })

  it('keeps a message whose own text contains a colon', () => {
    // "No such skill: abc" must not lose its second half to the prefix strip.
    expect(ipcErrorMessage(new Error('No such skill: abc'))).toBe('No such skill: abc')
  })

  it('falls back for a non-Error rejection', () => {
    expect(ipcErrorMessage('just a string')).toBe('Something went wrong')
    expect(ipcErrorMessage(undefined, 'Custom')).toBe('Custom')
  })

  it('falls back when unwrapping leaves nothing', () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'ipc-invoke': "))).toBe(
      'Something went wrong'
    )
  })
})
