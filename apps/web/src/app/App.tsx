import { useState } from 'react';
import { RouterProvider } from 'react-router-dom';

import { createAppRouter } from '@/app/routes';

export function App() {
  // Created once per mount so React StrictMode and tests never share router state.
  const [router] = useState(createAppRouter);
  return <RouterProvider router={router} />;
}
