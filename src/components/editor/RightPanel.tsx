import { useState } from 'react'
import { cn } from '@/lib/utils'
import { PropertiesPanel } from '@/components/editor/PropertiesPanel'
import { ChatlogPanel } from '@/components/editor/ChatlogPanel'

type RightTab = 'properties' | 'chatlog'

/**
 * Panel kanan dengan dua tab: Properties (default) dan Chatlog.
 * State tab bersifat lokal per instance (drawer mobile punya instance sendiri).
 */
export function RightPanel() {
  const [tab, setTab] = useState<RightTab>('properties')

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 border-b border-border">
        {(
          [
            ['properties', 'Properties'],
            ['chatlog', 'Chatlog'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex-1 cursor-pointer px-3 py-2.5 text-xs font-medium transition-colors',
              tab === key
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div>
        {tab === 'properties' ? <PropertiesPanel /> : <ChatlogPanel />}
      </div>
    </div>
  )
}
