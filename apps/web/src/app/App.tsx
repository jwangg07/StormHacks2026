import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { FirstPersonScreen } from '../game/FirstPersonScreen';
import { AvatarPage } from '../pages/AvatarPage';
import { LobbyPage } from '../pages/LobbyPage';
import { MultiplayerProvider } from '../net/MultiplayerProvider';

export function App() {
  return (
    <BrowserRouter>
      <MultiplayerProvider>
        <Routes>
          <Route path="/" element={<LobbyPage />} />
          <Route path="/avatar" element={<AvatarPage />} />
          <Route path="/game" element={<FirstPersonScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MultiplayerProvider>
    </BrowserRouter>
  );
}
