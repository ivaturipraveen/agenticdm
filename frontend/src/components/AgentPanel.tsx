import { usePipelineStore } from '../store/pipelineStore'
import AgentCard from './AgentCard'
import { AgentName } from '../types/pipeline'

const AGENT_ORDER: AgentName[] = ['discovery', 'transformation', 'orchestration', 'qa', 'monitor']

export default function AgentPanel() {
 const agents = usePipelineStore((s) => s.agents)

 return (
 <div className="flex flex-col gap-3 h-full overflow-y-auto">
 <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">Agent Status</div>
 {AGENT_ORDER.map((name) => (
 <AgentCard key={name} agent={agents[name]} />
 ))}
 </div>
 )
}
