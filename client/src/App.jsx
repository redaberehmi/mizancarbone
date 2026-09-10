import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { Layout } from './components/Layout.jsx';
import { Login } from './pages/Login.jsx';
import { Register } from './pages/Register.jsx';
import { CompanyProfile } from './pages/CompanyProfile.jsx';
import { DataCollection } from './pages/DataCollection.jsx';
import { CalculationResults } from './pages/CalculationResults.jsx';
import { CbamPreparation } from './pages/CbamPreparation.jsx';
import { FinancingWatch } from './pages/FinancingWatch.jsx';
import { Dashboard } from './pages/Dashboard.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/connexion" element={<Login />} />
          <Route path="/inscription" element={<Register />} />
          <Route
            path="/entreprise"
            element={
              <ProtectedRoute>
                <Layout>
                  <CompanyProfile />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/collecte"
            element={
              <ProtectedRoute>
                <Layout>
                  <DataCollection />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/calcul"
            element={
              <ProtectedRoute>
                <Layout>
                  <CalculationResults />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/preparation-cbam"
            element={
              <ProtectedRoute>
                <Layout>
                  <CbamPreparation />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/financements"
            element={
              <ProtectedRoute>
                <Layout>
                  <FinancingWatch />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/tableau-de-bord"
            element={
              <ProtectedRoute>
                <Layout>
                  <Dashboard />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/entreprise" replace />} />
          <Route path="*" element={<Navigate to="/entreprise" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
