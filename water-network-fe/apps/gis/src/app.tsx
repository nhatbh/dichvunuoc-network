import { RouterProvider, createRouter } from '@tanstack/solid-router'
import { Providers } from './app/providers'
import { routeTree } from './routeTree.gen'
import './app/app.css'

const router = createRouter({ routeTree })

declare module '@tanstack/solid-router' {
  interface Register {
    router: typeof router
  }
}

export default function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}
