# 🤝 Contributing Guide

Welcome to the project! This guide will help you understand our development workflow, coding standards, and best practices.

---

## 📋 Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Architecture Guidelines](#architecture-guidelines)
- [Commit Convention](#commit-convention)
- [Pull Request Process](#pull-request-process)
- [Testing Guidelines](#testing-guidelines)
- [Common Patterns](#common-patterns)

---

## 🚀 Getting Started

### Prerequisites

- **Node.js:** >= 18.x
- **npm:** >= 9.x
- **Git:** >= 2.x

### Initial Setup

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd frontend-sample
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up environment variables:**

   ```bash
   cp .env.example .env
   # Edit .env and fill in your values
   ```

4. **Initialize Git hooks:**

   ```bash
   npm run prepare
   ```

5. **Start development server:**

   ```bash
   npm run dev
   ```

6. **Verify setup:**
   - App should run at `http://localhost:3000`
   - No TypeScript errors: `npm run typecheck`
   - No lint errors: `npm run lint`

---

## 🔄 Development Workflow

### Branch Naming Convention

Use descriptive branch names with prefixes:

- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates
- `chore/` - Maintenance tasks
- `test/` - Test additions or updates

**Examples:**

```bash
feature/add-user-profile
fix/login-validation-error
refactor/payment-service
docs/update-api-guide
chore/update-dependencies
test/add-auth-tests
```

### Typical Workflow

1. **Create a new branch:**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write code
   - Add tests
   - Update documentation

3. **Run quality checks:**

   ```bash
   npm run typecheck    # Check TypeScript
   npm run lint:fix     # Fix linting issues
   npm run format       # Format code
   npm test             # Run tests
   ```

4. **Commit your changes:**

   ```bash
   git add .
   git commit -m "feat: add user profile page"
   ```

   _Note: Husky will automatically run lint-staged_

5. **Push to remote:**

   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request**
   - Use the PR template
   - Request reviews from team members
   - Address feedback

---

## 📝 Coding Standards

### TypeScript

✅ **Do:**

- Use strict TypeScript (already configured)
- Define explicit return types for functions
- Use `interface` for object shapes, `type` for unions/intersections
- Avoid `any` - use `unknown` instead
- Use `type` imports for types: `import type { User } from ...`

❌ **Don't:**

- Use `any` type
- Disable TypeScript errors with `@ts-ignore` (use `@ts-expect-error` with explanation if absolutely necessary)
- Define types in component files (move to `model/types.ts`)

**Example:**

```typescript
// ✅ Good
import type { User } from '@/entities/user/model/types'

export function getUserName(user: User | undefined): string {
  return user?.name ?? 'Guest'
}

// ❌ Bad
export function getUserName(user: any) {
  return user.name || 'Guest'
}
```

### SolidJS Components

✅ **Do:**

- Keep components reactive by accessing props directly as `props.something` or using `splitProps` / `mergeProps` from `solid-js`.
- Extract complex reactive state into custom hooks, signals, or stores.
- Use explicit return type `JSX.Element` for components.
- Keep components focused and small (< 200 lines).
- Use named exports.
- Use the `class` attribute for styling instead of `className`.

❌ **Don't:**

- **NEVER destructure props** in component function parameters or body (e.g., `const { label } = props`). This is a severe anti-pattern in SolidJS as it destroys the reactivity of the properties.
- Put heavy business logic directly in presentational components.
- Use default exports (for consistency).
- Mix UI and heavy backend business logic.
- Use `className` (SolidJS uses `class`).

**Example:**

```typescript
// ✅ Good
interface ButtonProps {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
}

export function Button(props: ButtonProps) {
  return (
    <button class={cn('btn', `btn-${props.variant ?? 'primary'}`)} onClick={() => props.onClick()}>
      {props.label}
    </button>
  )
}

// ❌ Bad — Destructuring destroys reactivity in SolidJS!
export function DestructuredButton({ label, onClick, variant = 'primary' }: ButtonProps) {
  return (
    <button class={cn('btn', `btn-${variant}`)} onClick={onClick}>
      {label}
    </button>
  )
}
```

````

### Styling (Tailwind CSS)

✅ **Do:**

- Use Tailwind utility classes
- Use `cn()` helper for conditional classes
- Follow mobile-first approach
- Use design tokens (colors, spacing)

❌ **Don't:**

- Write custom CSS (unless absolutely necessary)
- Use inline styles
- Use arbitrary values excessively

**Example:**

```typescript
// ✅ Good
<div className={cn(
  "flex items-center gap-4 p-4",
  "bg-white rounded-lg shadow-md",
  isActive && "border-2 border-blue-500",
  className
)}>

// ❌ Bad
<div style={{ display: 'flex', padding: '16px' }}>
````

### Import Order

Imports are automatically sorted by ESLint. The order is:

1. `solid-js` imports
2. External packages
3. Internal layers (app → pages → widgets → features → entities → shared)
4. Relative imports
5. Type imports

**Example:**

```typescript
import { createSignal, onMount } from 'solid-js'
import { useQuery } from '@tanstack/solid-query'
import { Button } from '@/shared/ui'
import { useSession } from '@/entities/session'
import type { User } from './types'
```

---

## 🏗️ Architecture Guidelines

### Feature-Sliced Design (FSD)

Our project follows FSD architecture. **Please read [`ARCHITECTURE_RULES.md`](./ARCHITECTURE_RULES.md)** for detailed guidelines.

#### Key Rules:

1. **Layer Hierarchy (top to bottom):**

   ```
   app → pages → widgets → features → entities → shared
   ```

2. **Import Direction:**
   - ✅ Layers can import from **lower layers only**
   - ❌ Never import from **higher layers**

3. **Cross-Layer Communication:**
   - Use **Event Bus** for cross-feature communication
   - Use **props** for parent-child communication
   - Use **TanStack Query** for server state

#### Example Structure:

```
src/features/create-post/
├── api/
│   └── use-create-post.ts    # API logic (TanStack Query)
├── ui/
│   └── CreatePostForm.tsx    # UI components
├── model/
│   └── types.ts              # TypeScript types
└── index.ts                  # Public API (exports)
```

### When to Create New Features vs. Entities

**Create a Feature when:**

- It's a **user action** (create, edit, delete, submit)
- It has **business logic** and side effects
- It modifies application state
- Examples: `sign-in`, `process-payment`, `create-post`

**Create an Entity when:**

- It's a **business domain object** (user, post, comment)
- It has **data representation** and display logic
- It's **reused across multiple features**
- Examples: `session`, `user`, `post`, `finance`

---

## 📝 Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, missing semicolons, etc.)
- `refactor`: Code refactoring (no functional changes)
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (deps, config, etc.)
- `ci`: CI/CD changes

### Examples:

```bash
feat(auth): add password reset functionality

fix(dashboard): resolve infinite loop in createEffect

docs(readme): update installation instructions

refactor(api): extract HTTP client interceptors

test(auth): add sign-in form validation tests

chore(deps): upgrade SolidJS to 1.9.0
```

### Scope Guidelines:

Use the FSD layer or feature name as scope:

- `auth`, `payment`, `dashboard`, `user-profile`
- `entities`, `features`, `shared`
- `api`, `ui`, `config`

---

## 🔍 Pull Request Process

### Before Creating a PR

- [ ] All tests pass: `npm test`
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] No lint errors: `npm run lint`
- [ ] Code is formatted: `npm run format:check`
- [ ] Feature is documented (if applicable)
- [ ] Commit messages follow convention

### PR Title Format

Use the same format as commit messages:

```
feat(auth): add two-factor authentication
```

### PR Description Template

```markdown
## Description

Brief description of what this PR does.

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## How to Test

1. Step-by-step instructions on how to test
2. ...

## Screenshots (if applicable)

[Add screenshots here]

## Checklist

- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No TypeScript errors
- [ ] No lint errors
- [ ] Follows FSD architecture
```

### Review Process

1. **Self-Review:** Review your own PR first
2. **Request Reviews:** Assign 2 reviewers minimum
3. **Address Feedback:** Respond to all comments
4. **Update PR:** Push new commits or amend
5. **Get Approval:** Require 2 approvals before merging
6. **Merge:** Use "Squash and merge" (unless specified otherwise)

---

## 🧪 Testing Guidelines

### Testing Strategy

- **Unit Tests:** Test individual functions and hooks
- **Integration Tests:** Test component interactions
- **E2E Tests:** Test critical user flows

### Writing Tests

**Location:** Co-locate tests with source files or in `__tests__` folder

**Naming:** `*.test.tsx` or `*.spec.tsx`

**Example:**

```typescript
// features/auth/sign-in/ui/sign-in-form.test.tsx
import { render, screen, fireEvent } from '@solidjs/testing-library'
import { SignInForm } from './sign-in-form'

describe('SignInForm', () => {
  it('should render email and password fields', () => {
    render(() => <SignInForm />)

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('should show validation error for invalid email', async () => {
    render(() => <SignInForm />)

    const emailInput = screen.getByLabelText(/email/i)
    fireEvent.input(emailInput, { target: { value: 'invalid' } })
    fireEvent.blur(emailInput)

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument()
  })
})
```

### Test Coverage

- Aim for **> 60%** overall coverage
- **Critical paths** should have **> 80%** coverage
- Run coverage: `npm run test:coverage`

---

## 🎯 Common Patterns

### API Calls

Always use TanStack Query for API calls:

```typescript
// ✅ Good — queryOptions in entity API
export const userQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: queryKeys.users.detail(userId),
    queryFn: () => httpClient.get(`/users/${userId}`),
  })

// In UI:
const query = useQuery(() => userQueryOptions(userId))

// ❌ Bad — ad-hoc fetch in createEffect without Query
```

### Form Handling

Use `@modular-forms/solid` + Zod (see `src/features/auth/sign-in/ui/sign-in-form.tsx`).

### Error Handling

Use centralized error handler:

```typescript
import { handleApiError } from '@/shared/api/error-handler'

try {
  await apiCall()
} catch (error) {
  handleApiError(error)
}
```

### Event Bus Communication

```typescript
// Emit event
const event = new PaymentSuccessEvent({ orderId, amount })
eventBus.emit(PAYMENT_SUCCESS, event)

// Listen in Solid (onMount + onCleanup)
onMount(() => {
  const handler = (event: PaymentSuccessEvent) => {
    /* ... */
  }
  eventBus.on(PAYMENT_SUCCESS, handler)
  onCleanup(() => eventBus.off(PAYMENT_SUCCESS, handler))
})
```

---

## ❓ Questions?

- **Architecture:** [`ARCHITECTURE_RULES.md`](./ARCHITECTURE_RULES.md)
- **Event Bus:** [`EVENT_BUS_GUIDE.md`](./EVENT_BUS_GUIDE.md)
- **Keycloak / SSO:** [`auth-keycloak.md`](./auth-keycloak.md), [`cross-app-sso.md`](./cross-app-sso.md)

**Need help?** Ask in the team Slack/Discord channel or ping the boilerplate champion.

---

## 🎉 Thank You!

Your contributions make this project better. Happy coding! 🚀
