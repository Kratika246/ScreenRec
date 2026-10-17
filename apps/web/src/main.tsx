import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import VideoViewer from './VideoViewer.tsx';

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/v/:id', element: <VideoViewer /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
