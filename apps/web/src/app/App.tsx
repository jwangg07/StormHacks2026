import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AvatarPage } from '../pages/AvatarPage';
import { GamePage } from '../pages/GamePage';
import { LobbyPage } from '../pages/LobbyPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/avatar" element={<AvatarPage />} />
        <Route path="/game" element={<GamePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
