// dsh-drop-caret client bundle (ModuleLoader format)
// dsh-drop-caret client half: document-level file drop handler that maps the
// drop point to a caret offset in the composer and inserts each file reference
// exactly there (instead of appending to the end).
//
// Two drop sources:
//   1. OS file manager — `Files` in dataTransfer → upload, insert stored path.
//   2. VS Code Explorer — `text/uri-list` / `application/vnd.code.tree` →
//      parse the local file:// URI to a path, insert it directly.
//
// IMPORTANT: listeners run in the CAPTURE phase and stop propagation, so the
// DSH built-in image-drop handler never sees a non-image file (which is what
// produced the "仅支持PNG/JPG/WebP/GIF" error + blue box).

window.__ModuleLoader__.load({ id: 'dsh-drop-caret', factory: (require) => {
  var module = { exports: {} }
  var exports = module.exports
  var React = require('react')

  var SOURCE_NAME = 'dsh-drop-caret'

  /** basename，兼容 Windows \ 与 POSIX / 分隔符。 */
  function basenameOf(path) {
    var i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
    return i === -1 ? path : path.slice(i + 1)
  }

  /** 把 drop 视口坐标映射成 composer textarea 的字符偏移（镜像 div + caretRangeFromPoint）。 */
  function caretOffsetFromPoint(x, y) {
    var ta = document.querySelector('textarea')
    if (ta === null) return -1
    var cs = getComputedStyle(ta)
    var r = ta.getBoundingClientRect()
    var m = document.createElement('div')
    var props = [
      'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'fontStyle', 'fontVariant', 'fontWeight', 'fontSize', 'fontFamily',
      'lineHeight', 'letterSpacing', 'tabSize', 'whiteSpace', 'wordBreak', 'textAlign'
    ]
    for (var i = 0; i < props.length; i++) {
      try { m.style[props[i]] = cs[props[i]] } catch (e) { /* ignore */ }
    }
    m.style.position = 'fixed'
    m.style.left = r.left + 'px'
    m.style.top = r.top + 'px'
    m.style.width = r.width + 'px'
    m.style.minHeight = r.height + 'px'
    m.style.whiteSpace = 'pre-wrap'
    m.style.wordBreak = 'break-word'
    m.style.color = 'transparent'
    m.style.background = 'transparent'
    m.style.zIndex = '2147483647'
    m.style.pointerEvents = 'none'
    m.contentEditable = 'true'
    m.textContent = ta.value || ''
    document.body.appendChild(m)

    var value = ta.value || ''
    var offset = value.length
    try {
      var rg = document.caretRangeFromPoint(x, y)
      if (rg && rg.startContainer && m.contains(rg.startContainer)) {
        offset = rg.startOffset
      }
    } catch (e) { /* fall back to append */ }
    m.remove()
    return offset
  }

  /** 在指定字符偏移处插入文件引用（label 显示文件名，clipboardText 为路径）。 */
  function insertReferenceAt(actx, ref, label, offset) {
    var conversation = actx.get('conversation')
    if (conversation === undefined) throw new Error('conversation service unavailable')
    var input = conversation.input.for(actx)
    var state = input.state.getSnapshot()
    var draftLen = state.draft.length
    var pos = offset < 0 || offset > draftLen ? draftLen : offset
    actx.emit('slash/input-insert-reference', {
      reference: {
        source: SOURCE_NAME,
        ref: ref,
        label: label,
        clipboardText: ref
      },
      span: { start: pos, end: pos, draftRev: state.draftRev }
    })
  }

  /** file:// URI / Windows 盘符路径 / POSIX 绝对路径 → 本地路径；否则 null。 */
  function fileUriToPath(uri) {
    if (typeof uri !== 'string') return null
    var u = uri.trim()
    if (u.indexOf('file://') === 0) {
      var p
      try { p = decodeURIComponent(u.slice('file://'.length)) } catch (e) { p = u.slice('file://'.length) }
      if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1)
      return p
    }
    if (/^[A-Za-z]:[\\/]/.test(u)) return u
    if (u.charAt(0) === '/') return u
    return null
  }

  function parseUriList(data) {
    return String(data).split(/\r?\n/)
      .map(function (l) { return l.trim() })
      .filter(function (l) { return l !== '' && l.charAt(0) !== '#' })
  }

  function extractUrisFromTree(data) {
    var out = []
    try { walk(JSON.parse(data)) } catch (e) { /* not valid JSON */ }
    function walk(node) {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) walk(node[i])
        return
      }
      var u = node.resource || node.resourceUri || node.uri
      if (typeof u === 'string') out.push(u)
      for (var k in node) {
        if (k === 'resource' || k === 'resourceUri' || k === 'uri') continue
        walk(node[k])
      }
    }
    return out
  }

  /** 递归遍历 FileSystemEntry（目录/文件），收集所有文件（扁平化）。 */
  async function collectFilesFromEntry(entry) {
    if (entry.isFile) {
      return new Promise(function (resolve) {
        entry.file(function (file) {
          resolve([file])
        }, function () {
          resolve([])
        })
      })
    }
    if (entry.isDirectory) {
      var reader = entry.createReader()
      var all = []
      var readBatch = function () {
        return new Promise(function (resolve) {
          reader.readEntries(function (entries) { resolve(entries) }, function () { resolve([]) })
        })
      }
      for (;;) {
        var batch = await readBatch()
        if (batch.length === 0) break
        for (var k = 0; k < batch.length; k++) {
          var sub = await collectFilesFromEntry(batch[k])
          all = all.concat(sub)
        }
      }
      return all
    }
    return []
  }

  /** 同步 snapshot DataTransfer 的 FileSystemEntry；drop 事件结束后 items 会失效。 */
  function snapshotEntries(dataTransfer) {
    var items = dataTransfer && dataTransfer.items
    if (!items) return []
    var entries = []
    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      if (item.kind !== 'file') continue
      var entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
      if (entry) entries.push(entry)
    }
    return entries
  }

  /** 从已 snapshot 的 FileSystemEntry 列表收集文件（含目录递归），用于文件夹拖拽。 */
  async function collectFilesFromEntries(entries) {
    if (!entries) return []
    var out = []
    for (var i = 0; i < entries.length; i++) {
      var collected = await collectFilesFromEntry(entries[i])
      out = out.concat(collected)
    }
    return out
  }

  /** 从 DataTransferItemList 收集文件（含目录递归），用于文件夹拖拽（files 为空时）。 */
  async function collectFilesFromItems(items) {
    if (!items) return []
    var out = []
    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      if (item.kind !== 'file') continue
      var entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
      if (!entry) continue
      var collected = await collectFilesFromEntry(entry)
      out = out.concat(collected)
    }
    return out
  }

  async function uploadOne(sessionId, file) {
    var res = await fetch('/api/dsh-drop', {
      method: 'POST',
      headers: {
        'x-file-name': encodeURIComponent(file.name),
        'x-session-id': sessionId
      },
      body: file
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    var payload = await res.json()
    if (typeof payload.path !== 'string') throw new Error('missing path in response')
    return payload.path
  }

  /** 调用 Host 端 API 递归列出文件夹中的所有文件。 */
  async function listDirectory(path) {
    var res = await fetch('/api/dsh-drop-list-dir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path })
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    var payload = await res.json()
    if (!Array.isArray(payload.files)) throw new Error('missing files in response')
    return payload.files
  }

  async function handleDrop(ctx, sessionId, payload, caret) {
    var actx = ctx.sessions.scope(sessionId)
    var pos = caret
    if (payload.kind === 'files') {
      // files 为空说明是「文件夹」拖拽：走 webkitGetAsEntry 递归收集目录里的文件。
      var files = payload.files
      if (files.length === 0 && payload.items) {
        files = await collectFilesFromItems(payload.items)
      }
      for (var i = 0; i < files.length; i++) {
        var file = files[i]
        try {
          var path = await uploadOne(sessionId, file)
          insertReferenceAt(actx, path, file.name, pos)
          pos += path.length + 1
        } catch (e) {
          console.error('[dsh-drop-caret] upload failed:', e)
        }
      }
    } else if (payload.kind === 'uris') {
      // VS Code Explorer 拖拽：可能是文件或文件夹。
      for (var j = 0; j < payload.uris.length; j++) {
        var p = fileUriToPath(payload.uris[j])
        if (p === null) continue
        try {
          // 调用 Host API 检查是文件还是文件夹，如果是文件夹则递归列出。
          var paths = await listDirectory(p)
          for (var k = 0; k < paths.length; k++) {
            insertReferenceAt(actx, paths[k], basenameOf(paths[k]), pos)
            pos += paths[k].length + 1
          }
        } catch (e) {
          console.error('[dsh-drop-caret] list/insert failed:', e)
        }
      }
    }
  }

  function DropCaret(props) {
    var handlerRef = React.useRef(props.onDrop)
    handlerRef.current = props.onDrop

    React.useEffect(function () {
      var depth = 0
      function kindOf(e) {
        var dt = e.dataTransfer
        if (!dt) return 'none'
        var types = dt.types || []
        if (Array.prototype.indexOf.call(types, 'Files') >= 0) return 'files'
        if (Array.prototype.indexOf.call(types, 'text/uri-list') >= 0 ||
            Array.prototype.indexOf.call(types, 'application/vnd.code.tree') >= 0) return 'uris'
        return 'none'
      }
      function isOurs(k) {
        return k === 'files' || k === 'uris'
      }
      function onDragEnter(e) {
        var k = kindOf(e)
        if (!isOurs(k)) return
        e.preventDefault()
        e.stopPropagation()
        depth += 1
      }
      function onDragOver(e) {
        var k = kindOf(e)
        if (!isOurs(k)) return
        e.preventDefault()
        e.stopPropagation()
      }
      function onDragLeave(e) {
        var k = kindOf(e)
        if (!isOurs(k)) return
        e.stopPropagation()
        if (e.relatedTarget === null) depth = Math.max(0, depth - 1)
      }
      function onDrop(e) {
        var k = kindOf(e)
        if (!isOurs(k)) return
        // 抢在 DSH 内置图片 drop 处理器之前：preventDefault + 停止传播，
        // 避免「仅支持PNG…」报错与其全屏遮罩弹出/卡住。
        e.preventDefault()
        e.stopPropagation()
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
        depth = 0
        var caret = caretOffsetFromPoint(e.clientX, e.clientY)
        var dt = e.dataTransfer

        if (k === 'files') {
          handlerRef.current({ kind: 'files', files: Array.prototype.slice.call(dt.files || []), entries: snapshotEntries(dt) }, caret)
          return
        }
        var uriList = dt.getData('text/uri-list')
        if (uriList) {
          var uris = parseUriList(uriList)
          if (uris.length > 0) {
            handlerRef.current({ kind: 'uris', uris: uris }, caret)
            return
          }
        }
        var treeData = dt.getData('application/vnd.code.tree')
        if (treeData) {
          var treeUris = extractUrisFromTree(treeData)
          if (treeUris.length > 0) {
            handlerRef.current({ kind: 'uris', uris: treeUris }, caret)
            return
          }
        }
      }
      function onDragEnd() {
        depth = 0
      }

      // window 捕获阶段 + 全生命周期拦截：抢在 DSH 内置拖拽/图片处理器之前，
      // 且不让它的全屏遮罩弹出或卡住。
      var W = window
      W.addEventListener('dragenter', onDragEnter, true)
      W.addEventListener('dragover', onDragOver, true)
      W.addEventListener('dragleave', onDragLeave, true)
      W.addEventListener('drop', onDrop, true)
      W.addEventListener('dragend', onDragEnd, true)
      return function () {
        W.removeEventListener('dragenter', onDragEnter, true)
        W.removeEventListener('dragover', onDragOver, true)
        W.removeEventListener('dragleave', onDragLeave, true)
        W.removeEventListener('drop', onDrop, true)
        W.removeEventListener('dragend', onDragEnd, true)
      }
    }, [])

    return null
  }

  function apply(ctx) {
    // 注册引用源：让 composer 认识 source=dsh-drop-caret 的引用，
    // 并提供序列化 codec（发送时把路径转成文本交给模型）。
    ctx.effect(function () {
      return ctx.inputTriggers.registerSource({
        trigger: '@',
        name: SOURCE_NAME,
        candidates: async function () { return [] },
        onPick: function () { return undefined },
        codec: {
          clipboardText: function (ref) { return ref },
          serialize: async function (ref) { return ref }
        }
      })
    })
    ctx.slots.inject('conversation.input.left', function () {
      return ctx.slots.register(
        {
          name: 'conversation.input.left',
          id: 'dsh-drop-caret',
          order: 0,
          inject: function (sessionId) {
            return {
              onDrop: function (payload, caret) {
                return handleDrop(ctx, sessionId, payload, caret)
              }
            }
          }
        },
        DropCaret
      )
    })
  }

  exports.apply = apply
  exports.inject = ['slots', 'inputTriggers', 'sessions']
  return module.exports
} })

// [end of dsh-drop-caret client bundle]