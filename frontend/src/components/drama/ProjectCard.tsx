import React from 'react'
import { Film, Clock, FolderOpen, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import { DramaProjectRecord } from '../../services/drama.service'
import { fluxService } from '../../services/flux.service'
import { STATUS_META } from '../../utils/drama-helpers'

export default function ProjectCard({
  project,
  onOpen,
  onDelete,
  onArchive,
  onUnarchive,
}: {
  project: DramaProjectRecord
  onOpen: (p: DramaProjectRecord) => void
  onDelete: (id: string) => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const meta = STATUS_META[project.status] ?? STATUS_META.draft
  const isArchived = !!project.archived_at

  return (
    <div className="bg-[#14141c] rounded-2xl border border-white/5 overflow-hidden hover:border-purple-500/20 transition-all group">
      {/* Thumbnail */}
      <div
        className="relative aspect-video bg-gradient-to-br from-purple-900/30 via-pink-900/20 to-[#1a1a2e] cursor-pointer overflow-hidden"
        onClick={() => onOpen(project)}
      >
        {(() => {
          // 封面 = 分镜拆分选定的图片，默认第一幅（preview_images 已按 effectiveShotImages 同序返回）
          const imgs = project.preview_images?.length
            ? project.preview_images
            : project.thumbnail_path
            ? [project.thumbnail_path]
            : []
          if (imgs.length === 0) {
            return (
              <div className="absolute inset-0 flex items-center justify-center">
                <Film className="w-10 h-10 text-purple-500/30" />
              </div>
            )
          }
          return (
            <img
              src={fluxService.getResultUrl(imgs[0])}
              alt={project.name}
              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            />
          )
        })()}
        <div className="absolute top-2 left-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${meta.cls}`}>
            {meta.label}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3
          className="text-sm font-semibold text-gray-100 line-clamp-1 cursor-pointer hover:text-purple-300 transition-colors mb-1"
          onClick={() => onOpen(project)}
        >
          {project.name}
        </h3>
        <div className="flex flex-wrap gap-1 mb-2">
          {project.genre     && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">{project.genre}</span>}
          {project.art_style && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">{project.art_style}</span>}
          {project.aspect_ratio && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500">{project.aspect_ratio}</span>}
          {project.episode_count > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">{project.episode_count}集</span>
          )}
        </div>
        {project.description && (
          <p className="text-[11px] text-gray-600 line-clamp-2 mb-2">{project.description}</p>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-700 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(project.updated_at).toLocaleDateString('zh-CN')}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onOpen(project)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors"
            >
              <FolderOpen className="w-3 h-3" />打开
            </button>
            {isArchived && onUnarchive ? (
              <button
                onClick={() => onUnarchive(project.project_id)}
                title="取消归档"
                className="w-6 h-6 flex items-center justify-center rounded-lg bg-white/[0.03] text-gray-600 hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
              >
                <ArchiveRestore className="w-3 h-3" />
              </button>
            ) : (!isArchived && onArchive ? (
              <button
                onClick={() => onArchive(project.project_id)}
                title="归档"
                className="w-6 h-6 flex items-center justify-center rounded-lg bg-white/[0.03] text-gray-600 hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
              >
                <Archive className="w-3 h-3" />
              </button>
            ) : null)}
            {confirmDelete ? (
              <>
                <button
                  onClick={() => onDelete(project.project_id)}
                  className="px-2 py-1 rounded-lg text-[11px] bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  确认
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 rounded-lg text-[11px] bg-white/5 text-gray-500 hover:bg-white/10 transition-colors"
                >
                  取消
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-6 h-6 flex items-center justify-center rounded-lg bg-white/[0.03] text-gray-600 hover:bg-red-500/10 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
