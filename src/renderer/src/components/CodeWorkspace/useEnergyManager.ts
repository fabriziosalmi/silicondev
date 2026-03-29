import { useState, useEffect } from 'react'

export function useEnergyManager() {
    const [batteryLevel, setBatteryLevel] = useState<number | null>(null)
    const [isCharging, setIsCharging] = useState<boolean | null>(null)
    const [lowPowerMode, setLowPowerMode] = useState(false)

    useEffect(() => {
        if (!('getBattery' in navigator)) return

        interface BatteryManager {
            level: number
            charging: boolean
            addEventListener: (event: string, fn: () => void) => void
            removeEventListener: (event: string, fn: () => void) => void
        }

        let battery: BatteryManager | null = null

        const updateStatus = () => {
            if (!battery) return
            setBatteryLevel(battery.level * 100)
            setIsCharging(battery.charging)
            setLowPowerMode(battery.level < 0.2 && !battery.charging)
        }

        // The Battery Status API is not in the standard TS lib types
        ;(navigator as unknown as { getBattery: () => Promise<BatteryManager> }).getBattery().then((batt) => {
            battery = batt
            updateStatus()
            batt.addEventListener('levelchange', updateStatus)
            batt.addEventListener('chargingchange', updateStatus)
        })

        return () => {
            if (battery) {
                battery.removeEventListener('levelchange', updateStatus)
                battery.removeEventListener('chargingchange', updateStatus)
            }
        }
    }, [])

    return { batteryLevel, isCharging, lowPowerMode }
}
