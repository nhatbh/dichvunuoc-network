/**
 * Sign-In form (Solid + @modular-forms/solid).
 */

import { createForm, zodForm } from '@modular-forms/solid'
import { z } from 'zod'
import { authClient } from '@/shared/lib/client-auth'
import { toast } from '@/shared/lib/toast'
import { TextField } from '@/shared/ui/forms'
import { Button } from '@/shared/ui/shadcn/button'

const signInSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type SignInFormData = z.infer<typeof signInSchema>

export function SignInForm() {
  const [form, { Form, Field }] = createForm<SignInFormData>({
    validate: zodForm(signInSchema),
  })

  return (
    <Form
      class="space-y-4"
      onSubmit={async values => {
        try {
          await authClient.signIn.email({ email: values.email, password: values.password })
          toast.success('Sign in successful', 'Welcome back!')
        } catch (error) {
          toast.error(
            'Sign in failed',
            error instanceof Error ? error.message : 'Please check your credentials.'
          )
        }
      }}
    >
      <Field name="email">
        {(field, props) => (
          <TextField
            {...props}
            id="email"
            type="email"
            label="Email"
            placeholder="Email"
            value={field.value ?? ''}
            error={field.error}
            required
          />
        )}
      </Field>
      <Field name="password">
        {(field, props) => (
          <TextField
            {...props}
            id="password"
            type="password"
            label="Password"
            placeholder="Password"
            value={field.value ?? ''}
            error={field.error}
            required
          />
        )}
      </Field>
      <Button type="submit" disabled={form.submitting} class="w-full">
        {form.submitting ? 'Signing in...' : 'Sign In'}
      </Button>
    </Form>
  )
}
