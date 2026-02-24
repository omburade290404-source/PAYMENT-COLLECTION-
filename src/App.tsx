/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  CreditCard, 
  CheckCircle2, 
  ShieldCheck, 
  User, 
  Phone, 
  MapPin, 
  IndianRupee, 
  ArrowRight,
  LayoutDashboard,
  LogOut,
  Search,
  Download,
  Loader2,
  AlertCircle,
  ChevronLeft,
  Trash2,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeCanvas } from 'qrcode.react';
import * as XLSX from 'xlsx';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface Payment {
  id: number;
  transaction_id: string;
  name: string;
  phone: string;
  address: string;
  amount: number;
  status: string;
  created_at: string;
}

// --- Components ---

const Input = ({ label, icon: Icon, ...props }: any) => (
  <div className="space-y-1.5 text-left">
    <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
      {Icon && <Icon size={16} className="text-slate-400" />}
      {label}
    </label>
    <input
      {...props}
      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all outline-none"
    />
  </div>
);

const TextArea = ({ label, icon: Icon, ...props }: any) => (
  <div className="space-y-1.5 text-left">
    <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
      {Icon && <Icon size={16} className="text-slate-400" />}
      {label}
    </label>
    <textarea
      {...props}
      rows={3}
      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all outline-none resize-none"
    />
  </div>
);

const Button = ({ children, variant = 'primary', className, loading, ...props }: any) => {
  const variants = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
    outline: 'border border-slate-200 text-slate-600 hover:bg-slate-50',
    danger: 'bg-red-500 text-white hover:bg-red-600',
  };

  return (
    <button
      disabled={loading}
      className={cn(
        'px-6 py-3 rounded-xl font-semibold transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg',
        variants[variant as keyof typeof variants],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" size={20} /> : children}
    </button>
  );
};

// --- Main App ---

export default function App() {
  const [view, setView] = useState<'form' | 'qr' | 'success' | 'admin-login' | 'admin-dashboard'>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPayment, setLastPayment] = useState<Payment | null>(null);
  const [upiUrl, setUpiUrl] = useState<string>('');
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    amount: ''
  });

  // Admin State
  const [adminAuth, setAdminAuth] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [trashPayments, setTrashPayments] = useState<Payment[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'active' | 'paused'>('active');

  // Fetch payment status and trash on mount
  useEffect(() => {
    fetchPaymentStatus();
    fetchTrash();

    // Receipt blocking logic
    localStorage.setItem('noReceipts', 'true');
    
    // Override receipt functions
    (window as any).printReceipt = () => false;
    (window as any).generateReceipt = () => false;
    (window as any).showReceipt = () => false;
    (window as any).emailReceipt = () => false;

    console.log(`Receipts hidden permanently on ${window.location.origin}`);

    // Enforce hiding via JS if needed (though CSS handles most)
    const enforceHiding = () => {
      if (localStorage.getItem('noReceipts') === 'true') {
        document.querySelectorAll('[class*="receipt"], [id*="receipt"], .receipt-modal').forEach(el => {
          (el as HTMLElement).style.display = 'none';
        });
      }
    };
    
    enforceHiding();
    const observer = new MutationObserver(enforceHiding);
    observer.observe(document.body, { childList: true, subtree: true });
    
    return () => observer.disconnect();
  }, []);

  const fetchPaymentStatus = async () => {
    try {
      const res = await fetch('/api/payment-status');
      const data = await res.json();
      if (data.value) setPaymentStatus(data.value);
    } catch (err) {
      console.error('Failed to fetch payment status');
    }
  };

  const togglePaymentStatus = async (newStatus: 'active' | 'paused') => {
    try {
      const res = await fetch('/api/admin/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        setPaymentStatus(newStatus);
      }
    } catch (err) {
      console.error('Failed to update payment status');
    }
  };

  // --- Handlers ---

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!formData.name || !formData.phone || !formData.address || !formData.amount) {
      setError('All fields are required');
      setLoading(false);
      return;
    }

    if (!/^\d{10}$/.test(formData.phone)) {
      setError('Please enter a valid 10-digit phone number');
      setLoading(false);
      return;
    }

    if (parseFloat(formData.amount) < 100) {
      setError('Minimum payment amount is ₹100');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/initiate-manual-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          amount: parseFloat(formData.amount)
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setUpiUrl(data.upiUrl);
      setView('qr');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const confirmPayment = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/submit-manual-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          amount: parseFloat(formData.amount)
        })
      });
      const result = await res.json();
      if (result.status === 'success') {
        setLastPayment(result.payment);
        if (localStorage.getItem('noReceipts') === 'true') {
          // Reset form and go back to form view instead of success
          setFormData({ name: '', phone: '', address: '', amount: '' });
          setView('form');
          alert('Payment submitted successfully');
        } else {
          setView('success');
        }
      } else {
        throw new Error('Failed to save payment');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const username = (form.elements.namedItem('username') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success) {
        setAdminAuth(true);
        fetchPayments();
        setView('admin-dashboard');
      } else {
        setError('Invalid credentials');
      }
    } catch (err) {
      setError('Login failed');
    }
  };

  const fetchPayments = async () => {
    try {
      const res = await fetch('/api/admin/payments');
      const data = await res.json();
      setPayments(data);
    } catch (err) {
      console.error('Failed to fetch payments');
    }
  };

  const clearPayments = async () => {
    if (!window.confirm('Are you sure you want to move all payment records to the Trash Bin? You can restore them later if needed.')) {
      return;
    }

    try {
      const res = await fetch('/api/admin/clear-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        setPayments([]);
        fetchTrash();
      } else {
        alert('Failed to clear payments');
      }
    } catch (err) {
      console.error('Failed to clear payments');
      alert('Failed to clear payments');
    }
  };

  const fetchTrash = async () => {
    try {
      const res = await fetch('/api/admin/trash');
      const data = await res.json();
      setTrashPayments(data);
    } catch (err) {
      console.error('Failed to fetch trash');
    }
  };

  const restorePayments = async () => {
    try {
      const res = await fetch('/api/admin/restore-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        fetchPayments();
        fetchTrash();
        setShowTrash(false);
      }
    } catch (err) {
      console.error('Failed to restore payments');
    }
  };

  const emptyTrash = async () => {
    if (!window.confirm('Are you sure you want to PERMANENTLY delete all records in trash? This cannot be undone.')) {
      return;
    }

    try {
      const res = await fetch('/api/admin/empty-trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        setTrashPayments([]);
      }
    } catch (err) {
      console.error('Failed to empty trash');
    }
  };

  const deletePayment = async (id: number) => {
    if (!window.confirm('Move this record to trash?')) return;
    try {
      const res = await fetch(`/api/admin/delete-payment/${id}`, { method: 'POST' });
      if ((await res.json()).success) {
        fetchPayments();
        fetchTrash();
      }
    } catch (err) {
      console.error('Failed to delete payment');
    }
  };

  const restorePayment = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/restore-payment/${id}`, { method: 'POST' });
      if ((await res.json()).success) {
        fetchPayments();
        fetchTrash();
      }
    } catch (err) {
      console.error('Failed to restore payment');
    }
  };

  const permanentDeletePayment = async (id: number) => {
    if (!window.confirm('Permanently delete this record? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/admin/permanent-delete/${id}`, { method: 'POST' });
      if ((await res.json()).success) {
        fetchTrash();
      }
    } catch (err) {
      console.error('Failed to permanently delete payment');
    }
  };

  const exportToExcel = () => {
    const formattedPayments = payments.map(p => ({
      ...p,
      created_at: new Date(p.created_at + ' UTC').toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    }));
    const worksheet = XLSX.utils.json_to_sheet(formattedPayments);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Payments");
    XLSX.writeFile(workbook, `Payments_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filteredPayments = useMemo(() => {
    return payments.filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.phone.includes(searchTerm) ||
      p.transaction_id?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [payments, searchTerm]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Main UI (Hidden on print) */}
      <div className="print:hidden flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-50">
        <div 
          className="flex items-center gap-2 cursor-pointer" 
          onClick={() => setView('form')}
        >
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-100">
            <IndianRupee size={24} />
          </div>
          <h1 className="text-xl font-display font-bold text-slate-900">PAYMENT COLLECTION</h1>
        </div>
        
        {view === 'form' && (
          <Button variant="outline" onClick={() => setView('admin-login')} className="px-4 py-2 text-sm">
            Admin Login
          </Button>
        )}

        {view === 'admin-dashboard' && (
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => { setAdminAuth(false); setView('form'); }} className="px-4 py-2 text-sm">
              <LogOut size={16} /> Logout
            </Button>
          </div>
        )}
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
        <AnimatePresence mode="wait">
          {/* Public Payment Form */}
          {view === 'form' && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-md mx-auto"
            >
              <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
                <div className="bg-emerald-600 p-8 text-white text-center">
                  <h2 className="text-2xl font-display font-bold mb-2">Payment Details</h2>
                  <p className="text-emerald-100 text-sm">Fill in the information below to proceed with your secure payment.</p>
                  <p className="text-emerald-200/60 text-[10px] uppercase tracking-widest mt-2 font-bold">Developed by OM BURADE</p>
                </div>
                
                {paymentStatus === 'paused' ? (
                  <div className="p-12 text-center space-y-6">
                    <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto">
                      <AlertCircle size={40} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-display font-bold text-slate-900">Payments Paused</h3>
                      <p className="text-slate-500 text-sm">The administrator has temporarily paused new payments. Please check back later.</p>
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => setView('admin-login')}>
                      Admin Login
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handlePayment} className="p-8 space-y-6">
                    {error && (
                      <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-center gap-3 text-sm border border-red-100">
                        <AlertCircle size={18} />
                        {error}
                      </div>
                    )}

                    <Input 
                      label="Name" 
                      icon={User} 
                      placeholder="John Doe"
                      value={formData.name}
                      onChange={(e: any) => setFormData({...formData, name: e.target.value})}
                    />

                    <div className="space-y-1.5 text-left">
                      <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                        <Phone size={16} className="text-slate-400" />
                        Phone Number
                      </label>
                      <div className="flex gap-2">
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 flex items-center text-slate-500 font-medium">
                          +91
                        </div>
                        <input
                          type="tel"
                          maxLength={10}
                          placeholder="9876543210"
                          className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all outline-none"
                          value={formData.phone}
                          onChange={(e: any) => setFormData({...formData, phone: e.target.value.replace(/\D/g, '')})}
                        />
                      </div>
                    </div>

                    <TextArea 
                      label="Complete Address" 
                      icon={MapPin} 
                      placeholder="Street, City, State, ZIP"
                      value={formData.address}
                      onChange={(e: any) => setFormData({...formData, address: e.target.value})}
                    />

                    <Input 
                      label="Payment Amount (₹)" 
                      icon={IndianRupee} 
                      type="number"
                      min="100"
                      placeholder="Min 100"
                      value={formData.amount}
                      onChange={(e: any) => setFormData({...formData, amount: e.target.value})}
                    />

                    <Button type="submit" className="w-full py-4 text-lg" loading={loading}>
                      Pay Now <ArrowRight size={20} />
                    </Button>

                    <div className="flex items-center justify-center gap-4 pt-4 border-t border-slate-100 opacity-50">
                      <ShieldCheck size={16} />
                      <span className="text-xs font-medium uppercase tracking-wider">Secure SSL Encryption</span>
                    </div>
                  </form>
                )}
              </div>
            </motion.div>
          )}

          {/* QR View */}
          {view === 'qr' && (
            <motion.div
              key="qr"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md mx-auto text-center"
            >
              <div className="bg-white rounded-3xl shadow-2xl p-8 border border-slate-100">
                <h2 className="text-2xl font-display font-bold text-slate-900 mb-2">Scan & Pay</h2>
                <p className="text-slate-500 mb-6 text-sm">Scan the QR code below using any UPI app (PhonePe, Google Pay, Paytm, etc.)</p>
                
                <div 
                  className="bg-slate-50 p-6 rounded-2xl inline-block mb-6 border border-slate-100 cursor-pointer hover:bg-slate-100 transition-all active:scale-95"
                  onClick={confirmPayment}
                >
                  {upiUrl ? (
                    <QRCodeCanvas 
                      value={upiUrl} 
                      size={200}
                      level="H"
                      includeMargin={true}
                      className="mx-auto"
                    />
                  ) : (
                    <img 
                      src="/qr-code.png" 
                      alt="Payment QR Code" 
                      className="w-[200px] h-[200px] object-contain mx-auto"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=Please_Upload_QR_Code";
                      }}
                    />
                  )}
                </div>

                <div className="text-left space-y-4 mb-8">
                  <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                    <p className="text-emerald-800 font-bold text-center text-xl">₹{formData.amount}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm border border-red-100">
                      {error}
                    </div>
                  )}
                  
                  <button 
                    onClick={() => setView('form')}
                    className="text-slate-400 text-sm hover:text-slate-600 block w-full"
                  >
                    Cancel & Go Back
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Success Page */}
          {view === 'success' && lastPayment && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md mx-auto text-center"
            >
              <div className="bg-white rounded-3xl shadow-2xl p-10 border border-slate-100">
                <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 size={48} />
                </div>
                <h2 className="text-3xl font-display font-bold text-slate-900 mb-2">Payment Successful!</h2>
                <p className="text-slate-500 mb-8">Your transaction has been processed securely.</p>
                
                <div className="bg-slate-50 rounded-2xl p-6 text-left space-y-4 mb-8">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Transaction ID</span>
                    <span className="font-mono font-bold text-slate-900">{lastPayment.transaction_id}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Amount Paid</span>
                    <span className="font-bold text-emerald-600">₹{lastPayment.amount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Date & Time</span>
                    <span className="text-slate-900">
                      {new Date(lastPayment.created_at + ' UTC').toLocaleString('en-IN', { 
                        timeZone: 'Asia/Kolkata',
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      })}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <Button variant="outline" className="w-full" onClick={() => setView('form')}>
                    Make Another Payment
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Admin Login */}
          {view === 'admin-login' && (
            <motion.div
              key="admin-login"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="max-w-sm mx-auto"
            >
              <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h2 className="text-xl font-display font-bold">Admin Portal</h2>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Developed by OM BURADE</p>
                  </div>
                </div>

                <form onSubmit={handleAdminLogin} className="space-y-6">
                  {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">
                      {error}
                    </div>
                  )}
                  <Input label="Username" name="username" placeholder="Abhay" required />
                  <Input label="Password" name="password" type="password" placeholder="••••••••" required />
                  <Button type="submit" className="w-full bg-slate-900 hover:bg-slate-800">
                    Login to Dashboard
                  </Button>
                  <button 
                    type="button"
                    onClick={() => setView('form')}
                    className="w-full text-slate-400 text-sm hover:text-slate-600 flex items-center justify-center gap-2"
                  >
                    <ChevronLeft size={16} /> Back to Payment Form
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {/* Admin Dashboard */}
          {view === 'admin-dashboard' && adminAuth && (
            <motion.div
              key="admin-dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-2xl font-display font-bold text-slate-900">Payment Dashboard</h2>
                  <p className="text-slate-500 text-sm">Manage and monitor all incoming payments in real-time.</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="bg-white p-1 rounded-xl border border-slate-200 flex gap-1 shadow-sm">
                    <button
                      onClick={() => togglePaymentStatus('active')}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2",
                        paymentStatus === 'active' 
                          ? "bg-emerald-600 text-white shadow-lg shadow-emerald-100" 
                          : "text-slate-400 hover:text-slate-600"
                      )}
                    >
                      <div className={cn("w-2 h-2 rounded-full", paymentStatus === 'active' ? "bg-white animate-pulse" : "bg-slate-300")} />
                      PLAY
                    </button>
                    <button
                      onClick={() => togglePaymentStatus('paused')}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2",
                        paymentStatus === 'paused' 
                          ? "bg-red-500 text-white shadow-lg shadow-red-100" 
                          : "text-slate-400 hover:text-slate-600"
                      )}
                    >
                      <div className={cn("w-2 h-2 rounded-full", paymentStatus === 'paused' ? "bg-white animate-pulse" : "bg-slate-300")} />
                      PAUSE
                    </button>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setShowTrash(!showTrash);
                      if (!showTrash) fetchTrash();
                    }}
                    className={cn(showTrash && "bg-slate-100", "relative")}
                  >
                    {showTrash ? <LayoutDashboard size={18} /> : <Trash2 size={18} />}
                    {showTrash ? "Back to Dashboard" : "Trash Bin"}
                    {!showTrash && trashPayments.length > 0 && (
                      <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-lg border-2 border-white">
                        {trashPayments.length}
                      </span>
                    )}
                  </Button>
                  {showTrash && (
                    <>
                      <Button variant="secondary" onClick={restorePayments}>
                        <RotateCcw size={18} /> Restore All
                      </Button>
                      <Button variant="danger" onClick={emptyTrash}>
                        <Trash2 size={18} /> Empty Trash
                      </Button>
                    </>
                  )}
                  <Button onClick={exportToExcel} className="bg-emerald-600 hover:bg-emerald-700">
                    <Download size={18} /> Export to Excel
                  </Button>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                      type="text" 
                      placeholder={showTrash ? "Search trash..." : "Search by name, phone or transaction ID..."}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="text-sm text-slate-500 font-medium">
                    {showTrash ? trashPayments.length : filteredPayments.length} {showTrash ? "Trashed" : "Payments"}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold">
                        <th className="px-6 py-4">Date & Time</th>
                        <th className="px-6 py-4">Name</th>
                        <th className="px-6 py-4">Contact</th>
                        <th className="px-6 py-4">Address</th>
                        <th className="px-6 py-4">Amount</th>
                        <th className="px-6 py-4">Transaction ID</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(showTrash ? trashPayments : filteredPayments).filter(p => 
                        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        p.phone.includes(searchTerm) ||
                        p.transaction_id?.toLowerCase().includes(searchTerm.toLowerCase())
                      ).map((payment) => (
                        <tr key={payment.id} className="hover:bg-slate-50 transition-colors text-sm">
                          <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                            {new Date(payment.created_at + ' UTC').toLocaleString('en-IN', { 
                              timeZone: 'Asia/Kolkata',
                              dateStyle: 'medium',
                              timeStyle: 'short'
                            })}
                          </td>
                          <td className="px-6 py-4 font-medium text-slate-900">
                            {payment.name}
                          </td>
                          <td className="px-6 py-4 text-slate-600">
                            +91 {payment.phone}
                          </td>
                          <td className="px-6 py-4 text-slate-500 max-w-xs truncate">
                            {payment.address}
                          </td>
                          <td className="px-6 py-4 font-bold text-emerald-600">
                            ₹{payment.amount}
                          </td>
                          <td className="px-6 py-4 font-mono text-xs text-slate-400">
                            {payment.transaction_id}
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-xs font-bold",
                              showTrash ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                            )}>
                              {showTrash ? "TRASHED" : "SUCCESS"}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              {showTrash ? (
                                <>
                                  <button 
                                    onClick={() => restorePayment(payment.id)}
                                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                    title="Restore"
                                  >
                                    <RotateCcw size={16} />
                                  </button>
                                  <button 
                                    onClick={() => permanentDeletePayment(payment.id)}
                                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Delete Permanently"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </>
                              ) : (
                                <button 
                                  onClick={() => deletePayment(payment.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Move to Trash"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(showTrash ? trashPayments : filteredPayments).length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                            {showTrash ? "Trash bin is empty." : "No payments found matching your search."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="print:hidden py-6 text-center border-t border-slate-100">
        <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">
          Developed & Designed by <span className="text-slate-600 font-bold">OM BURADE</span>
        </p>
      </footer>
      </div>
    </div>
  );
}
