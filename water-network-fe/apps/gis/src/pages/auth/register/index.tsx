/**
 * Register page — Solid.
 */

import { Link, useNavigate } from '@tanstack/solid-router'
import { Show, createSignal } from 'solid-js'
import { SignUpForm } from '@/features/auth/sign-up'
import { useSessionContext } from '@/entities/session/ui/session-provider'
import { env } from '@/shared/config/env'
import { authClient } from '@/shared/lib/client-auth'

export function RegisterPage() {
  const navigate = useNavigate()
  const { refreshSession } = useSessionContext()
  const [isSuccess, setIsSuccess] = createSignal(false)
  const [ssoLoading, setSsoLoading] = createSignal(false)

  const handleSuccess = async () => {
    await refreshSession()
    setIsSuccess(true)
    setTimeout(() => {
      void navigate({ to: '/' })
    }, 2000)
  }

  const handleSsoRegister = async () => {
    setSsoLoading(true)
    try {
      await authClient.signUp.email({ email: '', password: '' })
    } catch {
      setSsoLoading(false)
    }
  }

  return (
    <Show
      when={env.VITE_AUTH_MODE !== 'keycloak'}
      fallback={
        <div class="min-h-screen flex items-center justify-center bg-gray-50">
          <div class="max-w-md w-full space-y-8 p-8">
            <div>
              <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
                Create your account
              </h2>
              <p class="mt-2 text-center text-sm text-gray-600">
                Registration is handled by your organization's identity provider.
              </p>
            </div>
            <div class="mt-8 space-y-4">
              <button
                type="button"
                disabled={ssoLoading()}
                onClick={() => void handleSsoRegister()}
                class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {ssoLoading() ? 'Redirecting…' : 'Continue to registration (SSO)'}
              </button>
              <p class="text-center text-sm text-gray-600">
                Already have an account?{' '}
                <Link to="/login" class="font-medium text-indigo-600 hover:text-indigo-500">
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      }
    >
      <Show
        when={!isSuccess()}
        fallback={
          <div class="min-h-screen flex items-center justify-center bg-gray-50">
            <div class="max-w-md w-full space-y-8 p-8 text-center">
              <div class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
                <p class="font-medium">Account created successfully!</p>
                <p class="text-sm mt-1">Redirecting to dashboard...</p>
              </div>
            </div>
          </div>
        }
      >
        <div class="min-h-screen flex items-center justify-center bg-gray-50">
          <div class="max-w-md w-full space-y-8 p-8">
            <div>
              <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
                Create your account
              </h2>
              <p class="mt-2 text-center text-sm text-gray-600">
                Or{' '}
                <Link to="/login" class="font-medium text-indigo-600 hover:text-indigo-500">
                  sign in to your existing account
                </Link>
              </p>
            </div>
            <SignUpForm onSuccess={handleSuccess} />
          </div>
        </div>
      </Show>
    </Show>
  )
}
