import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Explorer from './pages/Explorer';
import Buddies from './pages/Buddies';
import Merchant from './pages/Merchant';
import GroupChat from './pages/GroupChat';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center goout-page-shell"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-goout-green" /></div>;
  if (!user) return <Navigate to="/login" />;
  return children;
}

function BuddiesRoute() {
  const { user } = useAuth();
  if (user?.role === 'merchant') return <Navigate to="/app/merchant" replace />;
  return <Buddies />;
}

function MerchantRoute() {
  const { user } = useAuth();
  if (user?.role !== 'merchant') return <Navigate to="/app" replace />;
  return <Merchant />;
}

function AppIndexRoute() {
  const { user } = useAuth();
  if (user?.role === 'merchant') return <Merchant />;
  return <Explorer />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/app" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<AppIndexRoute />} />
        <Route path="buddies" element={<BuddiesRoute />} />
        <Route path="merchant" element={<MerchantRoute />} />
        <Route path="group/:groupId" element={<GroupChat />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>);

}