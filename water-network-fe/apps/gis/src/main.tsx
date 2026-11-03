import { render } from 'solid-js/web'
import App from './app'
import { bootstrap } from './bootstrap'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

void bootstrap().then(() => {
  render(() => <App />, rootElement)
})
