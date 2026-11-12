export const SCOPES = ['memory:read', 'memory:write', 'memory:delete'] as const;

export type Scope = (typeof SCOPES)[number];

export const TOOL_SCOPES = {
  search_memory: 'memory:read',
  list_memories: 'memory:read',
  get_memory: 'memory:read',
  get_file_link: 'memory:read',
  save_memory: 'memory:write',
  forget_memory: 'memory:delete',
} as const satisfies Record<string, Scope>;

export type McpToolName = keyof typeof TOOL_SCOPES;

export const TOOLS_CALL = 'tools/call';

/** One JSON-RPC request as the bearer check sees it, from the `Mcp-*` headers or the body. */
export interface ToolCall {
  method?: string;
  name?: string;
}

function isToolName(name: string | undefined): name is McpToolName {
  return name !== undefined && Object.hasOwn(TOOL_SCOPES, name);
}

/** The scopes the calls need, each once. Only a known tool behind `tools/call` needs one. */
export function requiredScopes(calls: readonly ToolCall[]): Scope[] {
  const needed = new Set<Scope>();

  for (const call of calls) {
    if (call.method === TOOLS_CALL && isToolName(call.name)) {
      needed.add(TOOL_SCOPES[call.name]);
    }
  }

  return SCOPES.filter((scope) => needed.has(scope));
}

export function missingScopes(granted: readonly string[], required: readonly Scope[]): Scope[] {
  return required.filter((scope) => !granted.includes(scope));
}
