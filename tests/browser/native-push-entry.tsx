import React from 'react';
import { createRoot } from 'react-dom/client';
import { NativePushPreparation } from '../../src/components/NativePushPreparation';
const root = createRoot(document.getElementById('root')!);
(window as any).setTestUser = (userId: string) => root.render(<NativePushPreparation userId={userId} key={userId} />);
(window as any).setTestUser('user-a');
