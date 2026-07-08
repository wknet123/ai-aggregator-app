import React from 'react'
import { Film, Plus, Search, Loader2 } from 'lucide-react'
import { dramaService, DramaProjectRecord } from '../../services/drama.service'
import { useDebounce } from '../../utils/drama-helpers'
import ProjectCard from './ProjectCard'
import CreateProjectModal from './CreateProjectModal'

export default function ProjectList({
  onOpenProject,
  onCreate,
}: {
  onOpenProject: (project: DramaProjectRecord) => void
  onCreate: (project: DramaProjectRecord) => void
}) {
  const [projects, setProjects] = React.useState<DramaProjectRecord[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [searchInput, setSearchInput] = React.useState('')
  const [showArchived, setShowArchived] = React.useState(false)
  const [showCreate, setShowCreate] = React.useState(false)

  const q = useDebounce(searchInput, 400)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await dramaService.listProjects({
        q: q || undefined,
        archived: showArchived || undefined,
        limit: 24,
      })
      setProjects(result.items)
      setTotal(result.total)
    } catch {
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [q, showArchived])

  React.useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    try {
      await dramaService.deleteProject(id)
      setProjects(prev => prev.filter(p => p.project_id !== id))
      setTotal(t => t - 1)
    } catch { /* ignore */ }
  }

  const handleArchive = async (id: string) => {
    try {
      await dramaService.archiveProject(id)
      setProjects(prev => prev.filter(p => p.project_id !== id))
      setTotal(t => Math.max(0, t - 1))
    } catch { /* ignore */ }
  }

  const handleUnarchive = async (id: string) => {
    try {
      await dramaService.unarchiveProject(id)
      setProjects(prev => prev.filter(p => p.project_id !== id))
      setTotal(t => Math.max(0, t - 1))
    } catch { /* ignore */ }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0a0a0f]/95 backdrop-blur-sm border-b border-white/5 px-6 py-4">
        <div className="flex items-center gap-4 mb-4">
          <h1 className="text-lg font-bold text-gray-100 flex items-center gap-2">
            <Film className="w-5 h-5 text-purple-400" />
            我的短剧项目
          </h1>
          <span className="text-xs text-gray-600 bg-white/5 px-2 py-0.5 rounded-full">{total} 个项目</span>
          <button
            onClick={() => setShowCreate(true)}
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-purple-600 to-pink-500 text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            新建项目
          </button>
        </div>
        {/* Search + filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="搜索项目名称、概念、描述…"
              className="w-full bg-white/[0.03] border border-white/5 rounded-xl pl-9 pr-4 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
            />
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowArchived(v => !v)}
              className={`px-3 py-2 rounded-lg text-xs border transition-colors ${
                showArchived
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  : 'bg-[#1a1a2e] text-gray-400 border-white/5 hover:text-amber-300'
              }`}
            >
              {showArchived ? '查看未归档' : '查看已归档'}
            </button>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="px-6 py-5">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin text-purple-400" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Film className="w-16 h-16 text-gray-800 mb-4" />
            <p className="text-gray-500 text-base font-medium mb-2">
              {q ? '没有找到匹配的项目' : '还没有短剧项目'}
            </p>
            <p className="text-gray-700 text-sm mb-6">
              {q ? '试试其他搜索条件' : '点击「新建项目」开始你的AI短剧创作'}
            </p>
            {!q && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-purple-600 to-pink-500 text-white hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />新建项目
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {projects.map(p => (
              <ProjectCard
                key={p.project_id}
                project={p}
                onOpen={onOpenProject}
                onDelete={handleDelete}
                onArchive={handleArchive}
                onUnarchive={handleUnarchive}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProjectModal
          onCreated={project => { setShowCreate(false); onCreate(project) }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  )
}
