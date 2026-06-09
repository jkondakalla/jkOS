import App from '@jkos/beigeboard'

const API_URL = (import.meta as unknown as { env: Record<string, string> }).env.VITE_BEIGEBOARD_API_URL ?? '/api/beigeboard'

export default function Widget() {
  return <App apiUrl={API_URL} />
}
