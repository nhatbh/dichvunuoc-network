/**
 * Sign-Up form (Solid + @modular-forms/solid).
 */

import { createForm, zodForm } from '@modular-forms/solid'
import { z } from 'zod'
import { authClient } from '@/shared/lib/client-auth'
import { toast } from '@/shared/lib/toast'
import { TextField } from '@/shared/ui/forms'
import { Button } from '@/shared/ui/shadcn/button'

const signUpSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Please enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

type SignUpFormData = z.infer<typeof signUpSchema>

interface SignUpFormProps {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export function SignUpForm(props: SignUpFormProps) {
  const [form, { Form, Field }] = createForm<SignUpFormData>({
    validate: zodForm(signUpSchema),
  })

  return (
    <Form
      class="space-y-4"
      onSubmit={async values => {
        try {
          await authClient.signUp.email({
            email: values.email,
            password: values.password,
            name: values.name,
          })
          toast.success('Account created successfully', 'Welcome!')
          props.onSuccess?.()
        } catch (err) {
          const error = err instanceof Error ? err : new Error('Registration failed')
          toast.error('Registration failed', error.message)
          props.onError?.(error)
        }
      }}
    >
      <Field name="name">
        {(field, fieldProps) => (
          <TextField
            {...fieldProps}
            id="name"
            type="text"
            label="Name"
            placeholder="Your name"
            value={field.value ?? ''}
            error={field.error}
            required
          />
        )}
      </Field>
      <Field name="email">
        {(field, fieldProps) => (
          <TextField
            {...fieldProps}
            id="email"
            type="email"
            label="Email address"
            placeholder="Email address"
            value={field.value ?? ''}
            error={field.error}
            required
          />
        )}
      </Field>
      <Field name="password">
        {(field, fieldProps) => (
          <TextField
            {...fieldProps}
            id="password"
            type="password"
            label="Password"
            placeholder="Password (min. 8 characters)"
            value={field.value ?? ''}
            error={field.error}
            required
          />
        )}
      </Field>
      <Field name="confirmPassword">
        {(field, fieldProps) => (
          <TextField
            {...fieldProps}
            id="confirmPassword"
            type="password"
            label="Confirm Password"
            placeholder="Confirm password"
            value={field.value ?? ''}
            error={field.error}
            required
          />
        )}
      </Field>
      <Button type="submit" disabled={form.submitting} class="w-full">
        {form.submitting ? 'Creating account...' : 'Sign up'}
      </Button>
    </Form>
  )
}
