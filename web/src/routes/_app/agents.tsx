import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/agents')({
  component: AgentsLayout,
})

function AgentsLayout() {
  return <Outlet />
}
