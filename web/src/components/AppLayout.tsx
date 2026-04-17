import { Outlet } from '@tanstack/react-router'
import Navbar from '@/components/Navbar'
import PriceTicker from '@/components/PriceTicker'

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-[#1f2228]">
      <Navbar />
      <div className="pt-20">
        <PriceTicker />
        <main>
          <Outlet />
        </main>
      </div>
      <footer className="border-t border-white/6 mt-16 py-8">
        <div className="max-w-7xl mx-auto px-4 md:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <img src="/assets/inittap-logo.svg" alt="INITTAP" className="h-16" />
          <p className="font-sans text-[13px] text-white/30 tracking-[-0.01em]">
            Tap to predict. Win on Initia.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://twitter.com/inittap"
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-[12px] text-white/30 hover:text-white/70 transition-colors duration-200"
            >
              Twitter
            </a>
            <a
              href="https://scan.testnet.initia.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-[12px] text-white/30 hover:text-white/70 transition-colors duration-200"
            >
              Explorer
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
