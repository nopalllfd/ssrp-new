import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer as KonvaLayerNode, Rect, Text, Transformer, Image as KonvaImage, Line } from 'react-konva'
import type Konva from 'konva'
import { useEditorStore, resolveAutoTextFill } from '@/store/editor'
import type { Layer } from '@/types/editor'
import { loadAssetImage } from '@/lib/images'
import { effectiveCrop, layerVisibleForAsset } from '@/lib/editorDocument'
import { applyKonvaImageFilter } from '@/lib/imageFilters'
import { hasMixedAutoPurple, shiftStyleRanges } from '@/lib/richText'
import { RichTextNode } from './RichTextNode'

const SNAP_DISTANCE = 6
const GUIDE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]
const ALL_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

export function EditorCanvas({ width, height }: { width: number; height: number }) {
  const document = useEditorStore((s) => s.document)
  const selection = useEditorStore((s) => s.selection)
  const activeAssetId = useEditorStore((s) => s.activeAssetId)
  const zoom = useEditorStore((s) => s.zoom)
  const stagePos = useEditorStore((s) => s.stagePos)
  const setSelection = useEditorStore((s) => s.setSelection)
  const addToSelection = useEditorStore((s) => s.addToSelection)
  const setZoom = useEditorStore((s) => s.setZoom)
  const setStagePos = useEditorStore((s) => s.setStagePos)
  const mutate = useEditorStore((s) => s.mutate)
  const setTextSelection = useEditorStore((s) => s.setTextSelection)

  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const layerNodeRef = useRef<Konva.Layer>(null)
  const shapeRefs = useRef(new Map<string, Konva.Node>())
  const dragStart = useRef<Record<string, { x: number; y: number }>>({})
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })

  // Inline text editing state (double-click a text layer).
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')

  const editingLayer = useMemo(() => {
    if (!editingTextId) return null
    const l = document.layers.find((x) => x.id === editingTextId)
    return l && l.type === 'text' ? l : null
  }, [editingTextId, document.layers])

  const commitTextEdit = () => {
    if (!editingTextId) return
    const id = editingTextId
    const value = editingDraft
    mutate((doc) => {
      const l = doc.layers.find((x) => x.id === id)
      if (l?.type === 'text') {
        // Geser ranges gaya mengikuti selisih text lama → baru.
        if (l.styleRanges?.length) {
          l.styleRanges = shiftStyleRanges(l.styleRanges, l.text, value)
        }
        l.text = value
      }
    })
    setEditingTextId(null)
    setTextSelection(null)
  }

  const startTextEdit = (id: string) => {
    const l = document.layers.find((x) => x.id === id)
    if (!l || l.type !== 'text' || l.locked) return
    setEditingDraft(l.text)
    setEditingTextId(id)
    setTextSelection(null)
  }

  // Catat rangkaian karakter yang diseleksi user — gaya di PropertiesPanel
  // akan diterapkan hanya ke rangkaian ini.
  const captureTextSelection = (el: HTMLTextAreaElement) => {
    const { selectionStart, selectionEnd } = el
    if (editingTextId && selectionEnd > selectionStart) {
      setTextSelection({ layerId: editingTextId, start: selectionStart, end: selectionEnd })
    } else {
      setTextSelection(null)
    }
  }

  const selectedLayers = useMemo(
    () => document.layers.filter((l) => selection.includes(l.id) && !l.locked && l.visible),
    [document.layers, selection],
  )

  // Text adalah objek berukuran tetap (mengikuti kontennya) — hanya boleh
  // dipindah & diputar, tanpa handle resize width/height.
  const textOnlySelection =
    selectedLayers.length > 0 && selectedLayers.every((l) => l.type === 'text')

  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const nodes = selectedLayers
      .map((l) => shapeRefs.current.get(l.id))
      .filter((n): n is Konva.Node => !!n)
    tr.nodes(nodes)
    tr.getLayer()?.batchDraw()
  }, [selectedLayers])

  // Repaint setelah webfont termuat — render awal kanvas sempat pakai fallback.
  useEffect(() => {
    const fonts = window.document.fonts
    const redraw = () => layerNodeRef.current?.batchDraw()
    void fonts?.ready.then(redraw).catch(() => undefined)
    fonts?.addEventListener?.('loadingdone', redraw)
    return () => fonts?.removeEventListener?.('loadingdone', redraw)
  }, [])

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const factor = direction > 0 ? 1.1 : 1 / 1.1
    const newZoom = Math.min(Math.max(zoom * factor, 0.05), 8)
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / zoom,
      y: (pointer.y - stagePos.y) / zoom,
    }
    setZoom(newZoom)
    setStagePos({
      x: pointer.x - mousePointTo.x * newZoom,
      y: pointer.y - mousePointTo.y * newZoom,
    })
  }

  const commitTransform = (id: string, node: Konva.Node) => {
    mutate((doc) => {
      const layer = doc.layers.find((l) => l.id === id)
      if (!layer) return
      const scaleX = node.scaleX()
      const scaleY = node.scaleY()
      layer.x = node.x()
      layer.y = node.y()
      layer.rotation = node.rotation()
      if (layer.type === 'text') {
        // Glyph Konva.Text mengikuti fontSize, bukan width/height — tanpa ini
        // drag handle kembali ke ukuran semula begitu dilepas. Ukuran box teks
        // selalu auto (ikut konten), jadi width/height sengaja TIDAK ditulis.
        layer.fontSize = Math.max(4, layer.fontSize * scaleY)
        if (layer.styleRanges?.length) {
          layer.styleRanges = layer.styleRanges.map((r) =>
            r.fontSize !== undefined
              ? { ...r, fontSize: Math.max(4, r.fontSize * scaleY) }
              : r,
          )
        }
      } else {
        layer.width = Math.max(5, layer.width * scaleX)
        layer.height = Math.max(5, layer.height * scaleY)
      }
    })
    node.scale({ x: 1, y: 1 })
  }

  const onDragMove = (id: string, node: Konva.Node) => {
    // Snapping: canvas edges + center guides + rotation snapping during transform.
    const w = document.canvas.width
    const h = document.canvas.height
    const pos = node.position()
    const layer = document.layers.find((l) => l.id === id)
    if (!layer) return

    const edgesV = [0, w / 2, w]
    const edgesH = [0, h / 2, h]
    const nextGuides = { v: [] as number[], h: [] as number[] }
    let x = pos.x
    let y = pos.y

    const halfW = layer.width / 2
    const halfH = layer.height / 2
    for (const gx of edgesV) {
      if (Math.abs(x + halfW - gx) < SNAP_DISTANCE) {
        x = gx - halfW
        nextGuides.v.push(gx)
      }
      if (Math.abs(x - gx) < SNAP_DISTANCE) {
        x = gx
        nextGuides.v.push(gx)
      }
    }
    for (const gy of edgesH) {
      if (Math.abs(y + halfH - gy) < SNAP_DISTANCE) {
        y = gy - halfH
        nextGuides.h.push(gy)
      }
      if (Math.abs(y - gy) < SNAP_DISTANCE) {
        y = gy
        nextGuides.h.push(gy)
      }
    }
    node.position({ x, y })
    setGuides(nextGuides)
  }

  const onDragStart = (id: string, node: Konva.Node) => {
    dragStart.current[id] = { x: node.x(), y: node.y() }
  }

  const onDragEnd = (id: string, node: Konva.Node) => {
    setGuides({ v: [], h: [] })
    if (selection.length > 1 && selection.includes(id)) {
      // Multi-drag: apply the same delta to every other selected layer.
      const start = dragStart.current[id]
      if (start) {
        const dx = node.x() - start.x
        const dy = node.y() - start.y
        mutate((doc) => {
          for (const layer of doc.layers) {
            if (!selection.includes(layer.id) || layer.locked) continue
            if (layer.id === id) {
              layer.x = node.x()
              layer.y = node.y()
            } else {
              layer.x += dx
              layer.y += dy
            }
          }
        })
        return
      }
    }
    commitTransform(id, node)
  }

  const onTransformEnd = (id: string, node: Konva.Node) => {
    commitTransform(id, node)
  }

  const onStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (e.target === e.target.getStage() || e.target.name() === 'canvas-bg') {
      setSelection([])
    }
  }

  // Touch: single finger drags objects; two-finger pan/zoom is handled by
  // Konva's touch events mapped onto zoom state below.
  const touchState = useRef<{ dist: number; zoom: number } | null>(null)
  const onTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches
    if (touches.length === 2) {
      e.evt.preventDefault()
      const t1 = touches[0] as Touch
      const t2 = touches[1] as Touch
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
      if (!touchState.current) {
        touchState.current = { dist, zoom }
      } else {
        const factor = dist / touchState.current.dist
        const newZoom = Math.min(Math.max(touchState.current.zoom * factor, 0.05), 8)
        setZoom(newZoom)
      }
    }
  }
  const onTouchEnd = () => {
    touchState.current = null
  }

  return (
    <div className="relative" style={{ width, height, overflow: 'hidden' }}>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
      scaleX={zoom}
      scaleY={zoom}
      x={stagePos.x}
      y={stagePos.y}
      draggable={selection.length === 0}
      onWheel={onWheel}
      onClick={onStageClick}
      onTap={onStageClick}
      onDragEnd={(e) => {
        if (e.target === stageRef.current) {
          setStagePos({ x: e.target.x(), y: e.target.y() })
        }
      }}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ background: '#0a0a0a' }}
    >
      {/* Content layer: clipped to the canvas rect so anything that overhangs
          an edge is visually cut off instead of spilling out. */}
      <KonvaLayerNode
        ref={layerNodeRef}
        listening
        clipX={0}
        clipY={0}
        clipWidth={document.canvas.width}
        clipHeight={document.canvas.height}
      >
        <Rect
          name="canvas-bg"
          x={0}
          y={0}
          width={document.canvas.width}
          height={document.canvas.height}
          fill={document.canvas.background}
          listening={false}
        />
        {document.layers
          .filter((l) => l.visible)
          // Single-image canvas: only layers owned by the active asset render.
          // Other images (and their text/shapes) stay untouched in the doc.
          .filter((l) => layerVisibleForAsset(l, activeAssetId))
          .map((layer) => (
            <EditorShape
              key={layer.id}
              layer={layer}
              selected={selection.includes(layer.id)}
              registerRef={(id, node) => {
                if (node) shapeRefs.current.set(id, node)
                else shapeRefs.current.delete(id)
              }}
              onSelect={(e) => {
                const shift = 'shiftKey' in e.evt && e.evt.shiftKey
                if (shift) addToSelection(layer.id)
                else setSelection([layer.id])
              }}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onTransformEnd={onTransformEnd}
              onDblClick={startTextEdit}
              hidden={editingTextId === layer.id}
            />
          ))}
      </KonvaLayerNode>
      {/* Overlay layer: unclipped, so transformer handles and snap guides stay
          usable even when a layer pokes past the canvas edge. */}
      <KonvaLayerNode>
        {guides.v.map((x) => (
          <Line key={`v${x}`} points={[x, -20, x, document.canvas.height + 20]} stroke="#4f9cff" strokeWidth={1} dash={[4, 4]} listening={false} />
        ))}
        {guides.h.map((y) => (
          <Line key={`h${y}`} points={[-20, y, document.canvas.width + 20, y]} stroke="#4f9cff" strokeWidth={1} dash={[4, 4]} listening={false} />
        ))}
        <Transformer
          ref={trRef}
          flipEnabled={false}
          rotateEnabled
          enabledAnchors={textOnlySelection ? [] : ALL_ANCHORS}
          ignoreStroke
          anchorSize={8}
          anchorCornerRadius={2}
          borderStroke="#4f9cff"
          anchorStroke="#4f9cff"
          rotationSnaps={GUIDE_ANGLES}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 5 || newBox.height < 5 ? oldBox : newBox
          }
        />
      </KonvaLayerNode>
      </Stage>
      {editingLayer && (
        <textarea
          autoFocus
          value={editingDraft}
          onChange={(e) => setEditingDraft(e.target.value)}
          onSelect={(e) => captureTextSelection(e.currentTarget)}
          // Jangan hapus textSelection saat blur — user perlu seleksi tetap
          // aktif untuk menerapkan gaya dari panel properti sesudahnya.
          onBlur={commitTextEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commitTextEdit()
            } else if (e.key === 'Escape') {
              setEditingTextId(null)
              setTextSelection(null)
            }
          }}
          rows={Math.max(1, editingDraft.split('\n').length)}
          style={{
            position: 'absolute',
            left: editingLayer.x * zoom + stagePos.x,
            top: editingLayer.y * zoom + stagePos.y,
            // Selebar konten kalimat (satu baris per enter), tanpa wrap.
            width: 'max-content',
            fontSize: editingLayer.fontSize * zoom,
            fontFamily: editingLayer.fontFamily,
            fontWeight: editingLayer.fontWeight,
            fontStyle: editingLayer.fontStyle,
            // Preview ~ hasil akhir: teks campuran dasarnya putih (baris *
            // ungu hanya tampil setelah commit via renderer per-baris).
            color: resolveAutoTextFill(editingDraft, editingLayer.fill),
            lineHeight: editingLayer.lineHeight,
            letterSpacing: editingLayer.letterSpacing,
            textAlign: editingLayer.align,
            transform: editingLayer.rotation
              ? `rotate(${editingLayer.rotation}deg)`
              : undefined,
            transformOrigin: 'top left',
            background: 'transparent',
            border: '1px dashed #4f9cff',
            outline: 'none',
            resize: 'none',
            padding: 0,
            margin: 0,
            zIndex: 10,
          }}
        />
      )}
    </div>
  )
}

function EditorShape(props: {
  layer: Layer
  selected: boolean
  hidden?: boolean
  registerRef: (id: string, node: Konva.Node | null) => void
  onSelect: (e: Konva.KonvaEventObject<Event>) => void
  onDragStart: (id: string, node: Konva.Node) => void
  onDragMove: (id: string, node: Konva.Node) => void
  onDragEnd: (id: string, node: Konva.Node) => void
  onTransformEnd: (id: string, node: Konva.Node) => void
  onDblClick: (id: string) => void
}) {
  const { layer, selected, registerRef, hidden } = props
  const common = {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    rotation: layer.rotation,
    opacity: layer.opacity,
    draggable: !layer.locked,
    visible: !hidden,
    onClick: props.onSelect,
    onTap: props.onSelect,
    onDragStart: (e: Konva.KonvaEventObject<DragEvent>) =>
      props.onDragStart(layer.id, e.target),
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) =>
      props.onDragMove(layer.id, e.target),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
      props.onDragEnd(layer.id, e.target),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) =>
      props.onTransformEnd(layer.id, e.target),
    onDblClick: () => props.onDblClick(layer.id),
    onDblTap: () => props.onDblClick(layer.id),
  }

  if (layer.type === 'image') {
    return (
      <ImageShape
        layer={layer}
        common={common}
        selected={selected}
        registerRef={registerRef}
      />
    )
  }
  if (layer.type === 'text') {
    // Teks berukuran otomatis: ikuti konten (hanya pecah di `\n`), jadi jangan
    // kirim width/height ke node Konva — prop `undefined` akan menghapus attr
    // lama sehingga Konva.Text jatuh ke mode auto (tanpa word-wrap).
    const textCommon = { ...common, width: undefined, height: undefined }
    // Rich text: gaya per-rangkaian ATAU warna per-baris (prosa `*` di antara
    // baris biasa) memerlukan renderer kustom, bukan Konva.Text satu-warna.
    if (
      (layer.styleRanges && layer.styleRanges.length > 0) ||
      hasMixedAutoPurple(layer.text)
    ) {
      return <RichTextNode layer={layer} common={textCommon} registerRef={registerRef} />
    }
    return (
      <Text
        {...textCommon}
        ref={(n) => registerRef(layer.id, n)}
        text={layer.text}
        fontFamily={layer.fontFamily}
        fontSize={layer.fontSize}
        fontStyle={layer.fontStyle === 'italic' ? `italic ${layer.fontWeight}` : `${layer.fontWeight}`}
        fill={layer.fill}
        align={layer.align}
        lineHeight={layer.lineHeight}
        letterSpacing={layer.letterSpacing}
        stroke={layer.stroke || undefined}
        strokeWidth={layer.strokeWidth || undefined}
        fillAfterStrokeEnabled={!!layer.strokeWidth}
        shadowColor={layer.shadowBlur > 0 ? layer.shadowColor : undefined}
        shadowBlur={layer.shadowBlur || undefined}
        shadowOffsetX={layer.shadowOffsetX || undefined}
        shadowOffsetY={layer.shadowOffsetY || undefined}
      />
    )
  }
  return (
    <Rect
      {...common}
      ref={(n) => registerRef(layer.id, n)}
      fill={layer.fill}
      cornerRadius={layer.cornerRadius}
      stroke={layer.stroke || undefined}
      strokeWidth={layer.strokeWidth || undefined}
    />
  )
}

function ImageShape({
  layer,
  common,
  registerRef,
}: {
  layer: Extract<Layer, { type: 'image' }>
  common: Record<string, unknown>
  selected: boolean
  registerRef: (id: string, node: Konva.Node | null) => void
}) {
  const document = useEditorStore((s) => s.document)
  const asset = document.assets[layer.assetId]
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const nodeRef = useRef<Konva.Image | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!asset) return
    void loadAssetImage(asset).then((img) => {
      if (!cancelled) setImage(img)
    })
    return () => {
      cancelled = true
    }
  }, [asset?.id, asset?.objectKey, asset?.status, asset])

  const crop = effectiveCrop(layer, document)
  const filterKey = JSON.stringify(layer.filter ?? null)
  const cropKey = JSON.stringify(crop?.region ?? null)

  // Filter Konva butuh cache; segarkan cache saat gambar, nilai filter,
  // region crop, atau ukuran layer berubah.
  useEffect(() => {
    const node = nodeRef.current
    if (!node || !image) return
    applyKonvaImageFilter(node, layer.filter)
    node.getLayer()?.batchDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, filterKey, cropKey, layer.width, layer.height])

  if (!asset) return null

  const konvaCrop = crop
    ? {
        x: crop.region.x * asset.width,
        y: crop.region.y * asset.height,
        width: crop.region.w * asset.width,
        height: crop.region.h * asset.height,
      }
    : undefined

  return (
    <KonvaImage
      {...common}
      ref={(n) => {
        nodeRef.current = n
        registerRef(layer.id, n)
      }}
      image={image ?? undefined}
      crop={konvaCrop}
    />
  )
}
