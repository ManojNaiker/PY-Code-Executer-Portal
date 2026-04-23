"""
PyExec Tkinter headless shim.
Replaces tkinter / tkinter.ttk / tkinter.filedialog / tkinter.messagebox /
tkinter.simpledialog with no-op widget stubs so GUI scripts can run server-side.

User-supplied form values come from the JSON env var PYEXEC_TK_INPUTS:
  {
    "fields": { "<label>": "<value>", ... },
    "file":   "<absolute path or empty>",
    "action": "<button text to invoke from mainloop>"
  }
Field labels are matched (case-insensitively) against:
  - The text= of the Label that appears immediately before the widget in code,
  - The widget's name= keyword,
  - The associated *Var name (if any),
  - The prompt of input()/simpledialog calls.
"""
import sys, os, json, types

_RAW = os.environ.get("PYEXEC_TK_INPUTS", "{}")
try:
    _IN = json.loads(_RAW) if _RAW else {}
except Exception:
    _IN = {}

_FIELDS = { (k or "").strip().lower(): v for k, v in (_IN.get("fields") or {}).items() }
_FILE = _IN.get("file") or os.environ.get("PYEXEC_TK_FILE") or ""
_ACTION = (_IN.get("action") or "").strip().lower()

def _lookup(*keys):
    for k in keys:
        if not k: continue
        v = _FIELDS.get(str(k).strip().lower())
        if v not in (None, ""):
            return v
    return None

# ------------------------ tk variables ------------------------
class _Var:
    def __init__(self, master=None, value=None, name=None):
        self._name = name
        v = _lookup(name)
        if v is None and value is not None:
            v = value
        self._value = self._cast(v) if v is not None else self._default()
    def _default(self): return ""
    def _cast(self, v): return str(v) if v is not None else ""
    def get(self): return self._value
    def set(self, v): self._value = self._cast(v)
    def trace(self, *a, **k): pass
    def trace_add(self, *a, **k): pass
    def trace_remove(self, *a, **k): pass
    def trace_variable(self, *a, **k): pass

class _StringVar(_Var):
    def _default(self): return ""
    def _cast(self, v): return "" if v is None else str(v)

class _IntVar(_Var):
    def _default(self): return 0
    def _cast(self, v):
        try: return int(float(str(v)))
        except: return 0

class _DoubleVar(_Var):
    def _default(self): return 0.0
    def _cast(self, v):
        try: return float(v)
        except: return 0.0

class _BooleanVar(_Var):
    def _default(self): return False
    def _cast(self, v):
        if isinstance(v, bool): return v
        return str(v).strip().lower() in ("1", "true", "yes", "on")

# ------------------------ widget tracking ------------------------
_LAST_LABEL = [""]      # text of the most recently created Label
_BUTTONS = []           # [(text_lower, command, original_text)]

class _Widget:
    def __init__(self, master=None, *args, **kw):
        self._kw = dict(kw)
        self._textvariable = kw.get("textvariable")
        self._values = list(kw.get("values", []) or [])
        self._text = kw.get("text", "")
        self._command = kw.get("command")
        self._name = kw.get("name") or ""
        # remember the label that preceded this widget for .get() fallback
        self._assoc_label = _LAST_LABEL[0] or ""
    # geometry / lifecycle no-ops
    def pack(self, *a, **k): return self
    def grid(self, *a, **k): return self
    def place(self, *a, **k): return self
    def pack_forget(self, *a, **k): pass
    def grid_forget(self, *a, **k): pass
    def place_forget(self, *a, **k): pass
    def grid_columnconfigure(self, *a, **k): pass
    def grid_rowconfigure(self, *a, **k): pass
    def columnconfigure(self, *a, **k): pass
    def rowconfigure(self, *a, **k): pass
    def configure(self, **kw):
        if "textvariable" in kw: self._textvariable = kw["textvariable"]
        if "values" in kw: self._values = list(kw["values"] or [])
        if "text" in kw: self._text = kw["text"]
        if "command" in kw: self._command = kw["command"]
        self._kw.update(kw)
    config = configure
    def cget(self, k): return self._kw.get(k, "")
    def bind(self, *a, **k): pass
    def unbind(self, *a, **k): pass
    def bind_all(self, *a, **k): pass
    def focus(self, *a, **k): pass
    def focus_set(self, *a, **k): pass
    def focus_force(self, *a, **k): pass
    def destroy(self): pass
    def update(self, *a, **k): pass
    def update_idletasks(self, *a, **k): pass
    def after(self, ms=0, fn=None, *args):
        if callable(fn):
            try: fn(*args)
            except Exception: pass
        return "after#0"
    def after_cancel(self, *a, **k): pass
    def after_idle(self, fn=None, *args):
        if callable(fn):
            try: fn(*args)
            except Exception: pass
    def winfo_children(self): return []
    def winfo_exists(self): return 1
    def winfo_width(self): return 0
    def winfo_height(self): return 0
    def winfo_screenwidth(self): return 1024
    def winfo_screenheight(self): return 768
    def winfo_toplevel(self): return self
    # Text / Entry / Listbox style API
    def insert(self, *args, **kw):
        # Tk.Text.insert(index, chars) and Listbox.insert(index, *elements)
        if len(args) >= 2:
            for chunk in args[1:]:
                if chunk is None: continue
                s = str(chunk)
                if not s.endswith("\n"): s = s
                print(s, end="" if s.endswith("\n") else "\n")
    def delete(self, *a, **k): pass
    def see(self, *a, **k): pass
    def yview(self, *a, **k): pass
    def xview(self, *a, **k): pass
    def selection_clear(self, *a, **k): pass
    def selection_set(self, *a, **k): pass
    def curselection(self, *a, **k): return ()
    def get(self, *a, **k):
        # Text.get(start, end) — return empty
        if len(a) >= 2:
            return ""
        if self._textvariable is not None and hasattr(self._textvariable, "get"):
            v = self._textvariable.get()
            if v not in (None, "", 0):
                # If this var is associated with a file-picker label and the
                # value is clearly not a real path on this machine, prefer the
                # uploaded file instead.
                if _FILE and self._is_file_picker() and not os.path.exists(str(v)):
                    return _FILE
                return v
        v = _lookup(self._name, self._assoc_label,
                    getattr(self._textvariable, "_name", None))
        # Fallback: if this Entry looks like a file-picker (label/name mentions
        # file/path/csv/excel/etc.) and the user uploaded a file, prefer the
        # absolute path of that upload over whatever (often unusable, e.g.
        # "C:\\fakepath\\Format.csv" or just a bare filename) the form sent.
        if _FILE and self._is_file_picker():
            if v in (None, "") or not os.path.exists(str(v)):
                return _FILE
        return v if v is not None else ""

    def _is_file_picker(self):
        label_lower = (self._assoc_label or "").lower()
        name_lower = (str(self._name) or "").lower()
        tv_name = (str(getattr(self._textvariable, "_name", "")) or "").lower()
        haystack = " ".join((label_lower, name_lower, tv_name))
        return any(tok in haystack for tok in (
            "file", "path", "csv", "excel", "xlsx", "xls", "sheet",
            "workbook", "json", "image", "select", "browse", "upload",
        ))
    def current(self, idx=None):
        if idx is None:
            try:
                v = self.get()
                return self._values.index(v) if v in self._values else -1
            except: return -1
        try:
            self.set(self._values[idx])
        except: pass
    def set(self, v):
        if self._textvariable is not None and hasattr(self._textvariable, "set"):
            self._textvariable.set(v)
        else:
            self._kw["_setvalue"] = v
    def state(self, *a, **k): return ()
    def title(self, *a, **k): pass
    def geometry(self, *a, **k): pass
    def resizable(self, *a, **k): pass
    def minsize(self, *a, **k): pass
    def maxsize(self, *a, **k): pass
    def iconbitmap(self, *a, **k): pass
    def iconphoto(self, *a, **k): pass
    def protocol(self, *a, **k): pass
    def withdraw(self): pass
    def deiconify(self): pass
    def iconify(self): pass
    def attributes(self, *a, **k): pass
    def wait_window(self, *a, **k): pass
    def wait_visibility(self, *a, **k): pass
    def wait_variable(self, *a, **k): pass
    def grab_set(self): pass
    def grab_release(self): pass
    def lift(self, *a, **k): pass
    def tkraise(self, *a, **k): pass
    def __setitem__(self, k, v): self.configure(**{k: v})
    def __getitem__(self, k): return self.cget(k)
    # Catch-all for Canvas methods (create_oval/rectangle/line/text/image/...),
    # itemconfig, tag_*, mark_*, image_*, window_*, etc. Any unknown attribute
    # becomes a no-op callable that returns 0 (so item-id assignments work).
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        def _noop(*a, **k): return 0
        return _noop

class _Label(_Widget):
    def __init__(self, master=None, *args, **kw):
        super().__init__(master, *args, **kw)
        if self._text:
            _LAST_LABEL[0] = str(self._text).rstrip(":").strip()

class _Button(_Widget):
    def __init__(self, master=None, *args, **kw):
        super().__init__(master, *args, **kw)
        if self._text and callable(self._command):
            _BUTTONS.append((str(self._text).strip().lower(), self._command, str(self._text).strip()))
    def invoke(self):
        if callable(self._command): return self._command()

class _Tk(_Widget):
    def mainloop(self):
        # Pick a button to invoke
        if not _BUTTONS:
            return
        target = None
        if _ACTION:
            for low, cmd, orig in _BUTTONS:
                if low == _ACTION:
                    target = cmd; break
        if target is None:
            target = _BUTTONS[0][1]
        try:
            target()
        except SystemExit:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
    def quit(self): pass

# ------------------------ build modules ------------------------
def _mod(name):
    return types.ModuleType(name)

_tk = _mod("tkinter")
_tk.Tk = _Tk
_tk.Toplevel = _Tk
_tk.Frame = _Widget
_tk.LabelFrame = _Widget
_tk.Label = _Label
_tk.Entry = _Widget
_tk.Button = _Button
_tk.Text = _Widget
_tk.Listbox = _Widget
_tk.Canvas = _Widget
_tk.Checkbutton = _Widget
_tk.Radiobutton = _Widget
_tk.Scale = _Widget
_tk.Spinbox = _Widget
_tk.OptionMenu = _Widget
_tk.Menu = _Widget
_tk.Menubutton = _Widget
_tk.Scrollbar = _Widget
_tk.PanedWindow = _Widget
_tk.StringVar = _StringVar
_tk.IntVar = _IntVar
_tk.DoubleVar = _DoubleVar
_tk.BooleanVar = _BooleanVar
_tk.Variable = _StringVar
_tk.PhotoImage = _Widget
_tk.BitmapImage = _Widget
_tk.TclError = type("TclError", (Exception,), {})
_tk.Misc = _Widget
_tk.Wm = _Widget
_tk.Pack = _Widget
_tk.Grid = _Widget
_tk.Place = _Widget

# tk constants
for c in ("N","S","E","W","NE","NW","SE","SW","NS","EW","NSEW","CENTER","LEFT","RIGHT","TOP","BOTTOM","BOTH",
         "X","Y","NONE","HORIZONTAL","VERTICAL","DISABLED","NORMAL","ACTIVE","ANCHOR","INSERT",
         "RAISED","SUNKEN","FLAT","RIDGE","GROOVE","SOLID","SINGLE","BROWSE","MULTIPLE","EXTENDED",
         "WORD","CHAR","TRUE","FALSE","ON","OFF"):
    setattr(_tk, c, c.lower())
_tk.END = "end"
_tk.ANCHOR = "anchor"
_tk.INSERT = "insert"
_tk.SEL_FIRST = "sel.first"
_tk.SEL_LAST = "sel.last"

_ttk = _mod("tkinter.ttk")
for n in ("Frame","Label","Entry","Button","Combobox","Checkbutton","Radiobutton",
          "Progressbar","Treeview","Notebook","Scrollbar","Separator","Style",
          "LabelFrame","PanedWindow","Sizegrip","Spinbox","OptionMenu","Scale"):
    setattr(_ttk, n, _Label if n == "Label" else _Button if n == "Button" else _Widget)

_fd = _mod("tkinter.filedialog")
def _open(*a, **k): return _FILE or ""
def _opens(*a, **k): return ([_FILE] if _FILE else [])
def _save(*a, **k): return "/tmp/output.txt"
def _dir(*a, **k): return _FILE or "/tmp"
_fd.askopenfilename = _open
_fd.askopenfilenames = _opens
_fd.asksaveasfilename = _save
_fd.askdirectory = _dir
_fd.askopenfile = lambda *a, **k: open(_FILE, "rb") if _FILE and os.path.exists(_FILE) else None
_fd.asksaveasfile = lambda *a, **k: open("/tmp/output.txt", "w")

_mb = _mod("tkinter.messagebox")
def _info(title="", message="", **k):
    print(f"[INFO] {title}: {message}" if title else f"[INFO] {message}")
def _warn(title="", message="", **k):
    print(f"[WARN] {title}: {message}" if title else f"[WARN] {message}")
def _err(title="", message="", **k):
    print(f"[ERROR] {title}: {message}" if title else f"[ERROR] {message}", file=sys.stderr)
_mb.showinfo = _info
_mb.showwarning = _warn
_mb.showerror = _err
_mb.askyesno = lambda *a, **k: True
_mb.askokcancel = lambda *a, **k: True
_mb.askquestion = lambda *a, **k: "yes"
_mb.askretrycancel = lambda *a, **k: False
_mb.askyesnocancel = lambda *a, **k: True

_st = _mod("tkinter.scrolledtext")
_st.ScrolledText = _Widget

_dnd = _mod("tkinter.dnd")
_cc = _mod("tkinter.colorchooser")
_cc.askcolor = lambda *a, **k: ((0, 0, 0), "#000000")
_fnt = _mod("tkinter.font")
_fnt.Font = _Widget
_fnt.families = lambda *a, **k: []
_fnt.nametofont = lambda *a, **k: _Widget()

_sd = _mod("tkinter.simpledialog")
def _ask_str(title="", prompt="", **k):
    v = _lookup(prompt, title)
    return v if v is not None else ""
def _ask_int(title="", prompt="", **k):
    v = _lookup(prompt, title)
    try: return int(v) if v not in (None, "") else 0
    except: return 0
def _ask_float(title="", prompt="", **k):
    v = _lookup(prompt, title)
    try: return float(v) if v not in (None, "") else 0.0
    except: return 0.0
_sd.askstring = _ask_str
_sd.askinteger = _ask_int
_sd.askfloat = _ask_float

_tk.ttk = _ttk
_tk.filedialog = _fd
_tk.messagebox = _mb
_tk.simpledialog = _sd
_tk.scrolledtext = _st
_tk.font = _fnt
_tk.colorchooser = _cc

# Register modules — overrides the real tkinter so user code uses our stubs
for name, mod in [
    ("tkinter", _tk),
    ("tkinter.ttk", _ttk),
    ("tkinter.filedialog", _fd),
    ("tkinter.messagebox", _mb),
    ("tkinter.simpledialog", _sd),
    ("tkinter.scrolledtext", _st),
    ("tkinter.font", _fnt),
    ("tkinter.colorchooser", _cc),
    ("tkinter.dnd", _dnd),
    # legacy py2 names some scripts still use
    ("Tkinter", _tk),
    ("ttk", _ttk),
    ("tkFileDialog", _fd),
    ("tkMessageBox", _mb),
    # customtkinter — fall back to the same shim so simple scripts run
    ("customtkinter", _tk),
]:
    sys.modules[name] = mod

# customtkinter compat: CTk / CTkButton / etc. all map to base widgets
for n in ("CTk","CTkToplevel","CTkFrame","CTkLabel","CTkEntry","CTkButton",
         "CTkCheckBox","CTkRadioButton","CTkComboBox","CTkOptionMenu","CTkSlider",
         "CTkProgressBar","CTkScrollableFrame","CTkTabview","CTkSwitch","CTkTextbox",
         "CTkImage","CTkFont","CTkScrollbar"):
    setattr(_tk, n, _Tk if n in ("CTk","CTkToplevel") else _Button if "Button" in n else _Widget)
_tk.set_appearance_mode = lambda *a, **k: None
_tk.set_default_color_theme = lambda *a, **k: None
_tk.set_widget_scaling = lambda *a, **k: None
