import LazurosWidget from '@jkos/lazuros-widget'

// In dev: Vite proxy forwards /api/lazuros/* → LazurOS service (with prefix stripped)
// In prod: nginx forwards /api/lazuros/* → LazurOS container (with prefix stripped)
const API_URL = (import.meta as unknown as { env: Record<string, string> }).env.VITE_LAZUROS_API_URL ?? '/api/lazuros'

export default function Widget() {
  return <LazurosWidget apiUrl={API_URL} />
}
