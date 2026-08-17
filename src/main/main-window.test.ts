import { describe, expect, it, beforeEach, vi } from 'vitest'

interface FakeWindow {
  destroyed: boolean
  visible: boolean
  minimized: boolean
  focused: boolean
  isDestroyed: () => boolean
  isVisible: () => boolean
  isMinimized: () => boolean
  isFocused: () => boolean
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
}

let windows: FakeWindow[] = []

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windows }
}))

const { getMainWindow, isWindowAttended, setWindowFactory, showMainWindow } =
  await import('./main-window')

function fakeWindow(overrides: Partial<FakeWindow> = {}): FakeWindow {
  return {
    destroyed: false,
    visible: true,
    minimized: false,
    focused: true,
    isDestroyed(): boolean {
      return this.destroyed
    },
    isVisible(): boolean {
      return this.visible
    },
    isMinimized(): boolean {
      return this.minimized
    },
    isFocused(): boolean {
      return this.focused
    },
    show: vi.fn(),
    focus: vi.fn(),
    ...overrides
  }
}

beforeEach(() => {
  windows = []
  setWindowFactory(() => {})
})

describe('getMainWindow', () => {
  it('returns null when there is no window', () => {
    expect(getMainWindow()).toBeNull()
  })

  it('skips a destroyed window in favour of a live one', () => {
    const live = fakeWindow()
    windows = [fakeWindow({ destroyed: true }), live]

    expect(getMainWindow()).toBe(live)
  })

  it('returns null when every window is destroyed', () => {
    windows = [fakeWindow({ destroyed: true })]
    expect(getMainWindow()).toBeNull()
  })
})

describe('showMainWindow', () => {
  it('shows and focuses an existing window rather than creating another', () => {
    const window = fakeWindow()
    windows = [window]
    const factory = vi.fn()
    setWindowFactory(factory)

    showMainWindow()

    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(factory).not.toHaveBeenCalled()
  })

  it('falls back to the factory when no live window exists', () => {
    const factory = vi.fn()
    setWindowFactory(factory)

    showMainWindow()

    expect(factory).toHaveBeenCalledOnce()
  })

  // A destroyed window is the case the factory exists for: on macOS the app
  // outlives its window, and `activate` has to be able to bring one back.
  it('re-creates when the only window is destroyed', () => {
    windows = [fakeWindow({ destroyed: true })]
    const factory = vi.fn()
    setWindowFactory(factory)

    showMainWindow()

    expect(factory).toHaveBeenCalledOnce()
  })
})

describe('isWindowAttended', () => {
  it('is true only for a visible, unminimized, focused window', () => {
    windows = [fakeWindow()]
    expect(isWindowAttended()).toBe(true)
  })

  it('is false with no window at all', () => {
    expect(isWindowAttended()).toBe(false)
  })

  // Each condition alone must flip the answer — "attended" is the strictest
  // reading because the caller is deciding whether to stay quiet.
  it('is false for a hidden window', () => {
    windows = [fakeWindow({ visible: false })]
    expect(isWindowAttended()).toBe(false)
  })

  it('is false for a minimized window', () => {
    windows = [fakeWindow({ minimized: true })]
    expect(isWindowAttended()).toBe(false)
  })

  it('is false for an unfocused window', () => {
    windows = [fakeWindow({ focused: false })]
    expect(isWindowAttended()).toBe(false)
  })

  it('is false for a destroyed window', () => {
    windows = [fakeWindow({ destroyed: true })]
    expect(isWindowAttended()).toBe(false)
  })
})
