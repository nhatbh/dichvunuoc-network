/**
 * Login page — Solid.
 */

import { Link, getRouteApi, useRouter } from '@tanstack/solid-router'
import { Show, createSignal } from 'solid-js'
import { useSessionContext } from '@/entities/session/ui/session-provider'
import { env } from '@/shared/config/env'
import { toast } from '@/shared/lib/toast'

const loginRouteApi = getRouteApi('/login')

export function LoginPage() {
  const search = loginRouteApi.useSearch()
  const router = useRouter()
  const { login, loginSso } = useSessionContext()

  const [email, setEmail] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [isLoading, setIsLoading] = createSignal(false)

  const afterLoginPath = () => {
    const r = (search() as { redirect?: string }).redirect
    return r && r.startsWith('/') ? r : '/'
  }

  const handleSsoLogin = async () => {
    setIsLoading(true)
    try {
      const returnUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${afterLoginPath()}`
          : afterLoginPath()
      await loginSso(returnUrl)
    } catch (error) {
      console.error('SSO login error:', error)
      toast.error(
        'Sign-in failed',
        error instanceof Error ? error.message : 'Could not start single sign-on.'
      )
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      await login(email(), password())
      toast.success('Login successful', 'Welcome back!')
      router.history.push(afterLoginPath())
    } catch (error) {
      console.error('Login error:', error)
      toast.error(
        'Login failed',
        error instanceof Error ? error.message : 'Please check your credentials.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Show
      when={env.VITE_AUTH_MODE === 'keycloak'}
      fallback={
        <div class="min-h-screen flex items-center justify-center bg-gray-50">
          <div class="max-w-md w-full space-y-8 p-8">
            <div>
              <img src="/logo.png" alt="Mạng lưới cấp nước" class="mx-auto h-20 w-20" />
              <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
                Sign in to your account
              </h2>
              <p class="mt-2 text-center text-sm text-gray-600">
                Or{' '}
                <Link to="/register" class="font-medium text-teal-600 hover:text-teal-500">
                  create a new account
                </Link>
              </p>
            </div>
            <form class="mt-8 space-y-6" onSubmit={handleSubmit}>
              <div class="rounded-md shadow-sm -space-y-px">
                <div>
                  <label for="email">
                    <span class="sr-only">Email address</span>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autocomplete="email"
                      required
                      value={email()}
                      onInput={e => setEmail(e.currentTarget.value)}
                      class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-teal-500 focus:border-teal-500 focus:z-10 sm:text-sm"
                      placeholder="Email address"
                    />
                  </label>
                </div>
                <div>
                  <label for="password">
                    <span class="sr-only">Password</span>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      autocomplete="current-password"
                      required
                      value={password()}
                      onInput={e => setPassword(e.currentTarget.value)}
                      class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-teal-500 focus:border-teal-500 focus:z-10 sm:text-sm"
                      placeholder="Password"
                    />
                  </label>
                </div>
              </div>
              <div>
                <button
                  type="submit"
                  disabled={isLoading()}
                  class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:opacity-50"
                >
                  {isLoading() ? 'Signing in...' : 'Sign in'}
                </button>
              </div>
            </form>
          </div>
        </div>
      }
    >
      <div class="min-h-screen flex items-center justify-center bg-gray-50">
        <div class="max-w-md w-full space-y-8 p-8">
          <div>
            <img src="/logo.png" alt="Mạng lưới cấp nước" class="mx-auto h-20 w-20" />
            <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">Sign in</h2>
            <p class="mt-2 text-center text-sm text-gray-600">
              This application uses your organization's single sign-on (Keycloak).
            </p>
          </div>
          <div class="mt-8 space-y-4">
            <button
              type="button"
              disabled={isLoading()}
              onClick={() => void handleSsoLogin()}
              class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:opacity-50"
            >
              {isLoading() ? 'Redirecting…' : 'Continue with SSO'}
            </button>
            <p class="text-center text-sm text-gray-600">
              After sign-in you will return to{' '}
              <span class="font-medium text-gray-900">{afterLoginPath()}</span>
            </p>
          </div>
        </div>
      </div>
    </Show>
  )
}
