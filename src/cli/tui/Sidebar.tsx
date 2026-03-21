/**
 * Sidebar — Right panel with Quick Actions + Health Snapshot
 */

import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from './theme.js';
import type { HealthInfo, BackgroundInfo } from './data.js';
import type { ViewType } from './theme.js';

interface SidebarProps {
  health: HealthInfo;
  background: BackgroundInfo;
  onAction: (cmd: string) => void;
  activeView: ViewType;
}

const ACTIONS = [
  { key: 's', label: 'Search memory',   cmd: '/search' },
  { key: 'r', label: 'Remember',        cmd: '/remember' },
  { key: 'd', label: 'Doctor',          cmd: '/doctor' },
  { key: 'b', label: 'Background',      cmd: '/background' },
  { key: 'w', label: 'Dashboard',       cmd: '/dashboard' },
  { key: 'c', label: 'Configure',       cmd: '/configure' },
  { key: 'i', label: 'Integrate IDE',   cmd: '/integrate' },
];

export function Sidebar({ health, background, activeView }: SidebarProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      width={26}
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
    >
      {/* Actions */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.accent} bold>Actions</Text>
        {ACTIONS.map((a) => (
          <Box key={a.key}>
            <Text color={COLORS.accentDim}>{a.key}</Text>
            <Text color={COLORS.muted}> </Text>
            <Text color={COLORS.text}>{a.label}</Text>
          </Box>
        ))}
      </Box>

      {/* System */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.accentDim} bold>System</Text>
        <Box>
          <Text color={COLORS.muted}>{'Embed'.padEnd(8)}</Text>
          <Text color={
            health.embeddingProvider === 'ready' ? COLORS.success
            : health.embeddingProvider === 'unavailable' ? COLORS.warning
            : COLORS.muted
          }>{health.embeddingProvider}</Text>
        </Box>
        <Box>
          <Text color={COLORS.muted}>{'Search'.padEnd(8)}</Text>
          <Text color={
            health.searchMode.includes('hybrid') ? COLORS.success
            : health.searchMode.includes('vector') ? COLORS.accent
            : COLORS.warning
          }>{health.searchMode}</Text>
        </Box>
        <Box>
          <Text color={COLORS.muted}>{'Memory'.padEnd(8)}</Text>
          <Text color={COLORS.text}>{health.activeMemories}</Text>
        </Box>
      </Box>

      {/* Control Plane */}
      <Box flexDirection="column">
        <Text color={COLORS.accentDim} bold>Control Plane</Text>
        <Box>
          <Text color={background.healthy ? COLORS.success : background.running ? COLORS.warning : COLORS.muted}>
            {background.healthy ? '● Running' : background.running ? '● Unhealthy' : '○ Stopped'}
          </Text>
        </Box>
        {background.port && (
          <Text color={COLORS.textDim}>:{background.port}</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.muted} dimColor>/ commands  ctrl+c quit</Text>
      </Box>
    </Box>
  );
}
