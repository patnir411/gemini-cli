/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { render } from 'ink';
import { SessionData } from '../utils/sessionManager.js';

interface Props {
  sessions: SessionData[];
  onSelect: (session: SessionData) => void;
}

export const SessionSelector = ({ sessions, onSelect }: Props) => {
  const items = sessions.map((s) => ({
    label: `${new Date(s.startTime).toLocaleString()} – ${s.sessionId}`,
    value: s.sessionId,
  }));

  const handleSelect = (item: { value: string }) => {
    const session = sessions.find((s) => s.sessionId === item.value);
    if (session) onSelect(session);
  };

  return (
    <Box flexDirection="column">
      <Text>Select a session to resume:</Text>
      <SelectInput items={items} onSelect={handleSelect} />
    </Box>
  );
};

export function promptSessionSelection(sessions: SessionData[]): Promise<SessionData> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <SessionSelector
        sessions={sessions}
        onSelect={(session) => {
          resolve(session);
          unmount();
        }}
      />,
    );
  });
}
