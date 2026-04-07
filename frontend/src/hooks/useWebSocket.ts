import { useEffect, useRef } from 'react'
import { usePipelineStore } from '../store/pipelineStore'
import { WsEvent } from '../types/pipeline'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

export function useWebSocket(): void {
 const handleWsEvent = usePipelineStore((s) => s.handleWsEvent)
 const wsRef = useRef<WebSocket | null>(null)
 const reconnectDelay = useRef(1000)
 const mountedRef = useRef(true)

 useEffect(() => {
 mountedRef.current = true

 function connect() {
 if (!mountedRef.current) return
 const ws = new WebSocket(WS_URL)
 wsRef.current = ws

 ws.onopen = () => {
 reconnectDelay.current = 1000
 }

 ws.onmessage = (ev: MessageEvent<string>) => {
 try {
 const event = JSON.parse(ev.data) as WsEvent
 handleWsEvent(event)
 } catch {
 // ignore malformed messages
 }
 }

 ws.onclose = () => {
 if (!mountedRef.current) return
 const delay = reconnectDelay.current
 reconnectDelay.current = Math.min(delay * 2, 30000)
 setTimeout(connect, delay)
 }

 ws.onerror = () => {
 ws.close()
 }
 }

 connect()

 return () => {
 mountedRef.current = false
 wsRef.current?.close()
 }
 }, [handleWsEvent])
}
