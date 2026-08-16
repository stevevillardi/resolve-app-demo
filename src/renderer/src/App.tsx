import Versions from './components/Versions'
import electronLogo from './assets/electron.svg'
import { useUiStore } from './store/useUiStore'

function App(): React.JSX.Element {
  // Proves the Zustand store is wired end to end; real usage starts in Phase 2.
  const activeContactId = useUiStore((state) => state.activeContactId)
  const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')

  return (
    <>
      <img alt="logo" className="logo" src={electronLogo} />
      <div className="creator">Powered by electron-vite</div>
      <div className="text">
        Build an Electron app with <span className="react">React</span>
        &nbsp;and <span className="ts">TypeScript</span>
      </div>
      <p className="tip">
        Please try pressing <code>F12</code> to open the devTool
      </p>
      <p className="tip">Active contact (Zustand): {activeContactId ?? 'none'}</p>
      <div className="actions">
        <div className="action">
          <a href="https://electron-vite.org/" target="_blank" rel="noreferrer">
            Documentation
          </a>
        </div>
        <div className="action">
          <a target="_blank" rel="noreferrer" onClick={ipcHandle}>
            Send IPC
          </a>
        </div>
      </div>
      <Versions></Versions>
    </>
  )
}

export default App
