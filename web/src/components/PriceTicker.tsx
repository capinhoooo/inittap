import { useQuery } from '@tanstack/react-query'
import type { OraclePrice } from '@/lib/api'
import { getPrices } from '@/lib/api'
import { cnm } from '@/utils/style'

function formatOraclePrice(raw: string, decimals: number): string {
  const val = parseFloat(raw) / 10 ** decimals
  if (val >= 1000) {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
  if (val >= 1) return val.toFixed(2)
  return val.toFixed(4)
}

function TickerItem({ price }: { price: OraclePrice }) {
  const formatted = formatOraclePrice(price.price, price.decimals)

  return (
    <div className="flex items-center gap-3 px-6 shrink-0">
      <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-live-pulse" />
      <span className="font-sans text-[12px] uppercase tracking-[0.05em] text-white/30 font-medium">
        {price.id}
      </span>
      <span className="font-mono text-[13px] tabular-nums text-white">
        ${formatted}
      </span>
    </div>
  )
}

export default function PriceTicker() {
  const { data: prices } = useQuery({
    queryKey: ['prices'],
    queryFn: getPrices,
    refetchInterval: 5000,
    staleTime: 3000,
  })

  if (!prices || prices.length === 0) {
    return (
      <div className="h-8 border-b border-white/6 bg-[#191b20] flex items-center px-4">
        <span className="font-mono text-[11px] text-white/20">
          Loading prices...
        </span>
      </div>
    )
  }

  const items = [...prices, ...prices]

  return (
    <div className="h-8 border-b border-white/6 bg-[#191b20] overflow-hidden flex items-center">
      <div
        className={cnm('flex items-center whitespace-nowrap animate-ticker')}
      >
        {items.map((price, i) => (
          <TickerItem key={`${price.id}-${i}`} price={price} />
        ))}
      </div>
    </div>
  )
}
