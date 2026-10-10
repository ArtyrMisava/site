package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	serverVersion = "1.0.0"
	defaultPort   = 4173
	maxStateSize  = 32 << 20
)

var allowedStorageKeys = map[string]bool{
	"lokus-admin-credentials-v1": true,
	"lokus-map-items-v1":        true,
	"dus-map-coordinate-version": true,
	"dus-map-view-link-v1":       true,
	"dus-map-layer-mode-v1":      true,
}

type diskState struct {
	Format    int               `json:"format"`
	UpdatedAt string            `json:"updatedAt"`
	Entries   map[string]string `json:"entries"`
}

type storageResponse struct {
	Initialized bool              `json:"initialized"`
	Entries     map[string]string `json:"entries"`
}

type storageRequest struct {
	Entries map[string]string `json:"entries"`
}

type application struct {
	root      string
	statePath string
	stateMu   sync.Mutex
}

func executableDefaults() (string, string) {
	executable, err := os.Executable()
	if err != nil {
		working, _ := os.Getwd()
		return filepath.Join(working, "offline-site"), filepath.Join(working, "site-data", "dus-data.json")
	}
	base := filepath.Dir(executable)
	if strings.EqualFold(filepath.Base(base), "runtime") {
		base = filepath.Dir(base)
	}
	return filepath.Join(base, "offline-site"), filepath.Join(base, "site-data", "dus-data.json")
}

func readState(path string) (diskState, bool, error) {
	state := diskState{Format: 1, Entries: map[string]string{}}
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return state, false, nil
	}
	if err != nil {
		return state, false, err
	}
	if err := json.Unmarshal(content, &state); err != nil {
		backup, backupErr := os.ReadFile(path + ".bak")
		if backupErr != nil || json.Unmarshal(backup, &state) != nil {
			return diskState{}, true, fmt.Errorf("data file is damaged: %w", err)
		}
	}
	if state.Entries == nil {
		state.Entries = map[string]string{}
	}
	return state, true, nil
}

func writeState(path string, state diskState) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	state.Format = 1
	state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if state.Entries == nil {
		state.Entries = map[string]string{}
	}
	content, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	content = append(content, '\n')

	if previous, readErr := os.ReadFile(path); readErr == nil {
		_ = os.WriteFile(path+".bak", previous, 0600)
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, content, 0600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		// Windows does not replace an existing file with os.Rename on every
		// supported release. The .bak copy above protects the last good state.
		if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			_ = os.Remove(temporary)
			return err
		}
		if renameErr := os.Rename(temporary, path); renameErr != nil {
			return renameErr
		}
	}
	return nil
}

func validRequestOrigin(request *http.Request) bool {
	origin := request.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Host, request.Host) && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-DUS-Storage", "folder")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func (app *application) storageHandler(response http.ResponseWriter, request *http.Request) {
	if !validRequestOrigin(request) {
		http.Error(response, "Forbidden", http.StatusForbidden)
		return
	}

	app.stateMu.Lock()
	defer app.stateMu.Unlock()

	switch request.Method {
	case http.MethodGet:
		state, initialized, err := readState(app.statePath)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(response, http.StatusOK, storageResponse{Initialized: initialized, Entries: state.Entries})
	case http.MethodPut, http.MethodPost:
		request.Body = http.MaxBytesReader(response, request.Body, maxStateSize)
		decoder := json.NewDecoder(request.Body)
		var payload storageRequest
		if err := decoder.Decode(&payload); err != nil {
			writeJSON(response, http.StatusBadRequest, map[string]string{"error": "Invalid data"})
			return
		}
		entries := map[string]string{}
		totalSize := 0
		for key, value := range payload.Entries {
			if !allowedStorageKeys[key] {
				continue
			}
			totalSize += len(key) + len(value)
			if totalSize > maxStateSize {
				writeJSON(response, http.StatusRequestEntityTooLarge, map[string]string{"error": "Data is too large"})
				return
			}
			entries[key] = value
		}
		state := diskState{Format: 1, Entries: entries}
		if err := writeState(app.statePath, state); err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(response, http.StatusOK, map[string]bool{"saved": true})
	default:
		response.Header().Set("Allow", "GET, PUT, POST")
		http.Error(response, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func contentType(path string) string {
	extension := strings.ToLower(filepath.Ext(path))
	types := map[string]string{
		".html": "text/html; charset=utf-8",
		".js":   "text/javascript; charset=utf-8",
		".css":  "text/css; charset=utf-8",
		".json": "application/json; charset=utf-8",
		".svg":  "image/svg+xml",
		".webp": "image/webp",
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	}
	if value := types[extension]; value != "" {
		return value
	}
	if value := mime.TypeByExtension(extension); value != "" {
		return value
	}
	return "application/octet-stream"
}

func (app *application) staticHandler(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		http.Error(response, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cleanURLPath := strings.TrimPrefix(filepath.ToSlash(filepath.Clean("/"+request.URL.Path)), "/")
	if cleanURLPath == "" || cleanURLPath == "." {
		cleanURLPath = "index.html"
	}
	fullPath := filepath.Join(app.root, filepath.FromSlash(cleanURLPath))
	relative, err := filepath.Rel(app.root, fullPath)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		http.Error(response, "Forbidden", http.StatusForbidden)
		return
	}

	info, statErr := os.Stat(fullPath)
	if statErr == nil && info.IsDir() {
		fullPath = filepath.Join(fullPath, "index.html")
		info, statErr = os.Stat(fullPath)
	}
	if statErr != nil {
		if filepath.Ext(fullPath) == "" {
			fullPath = filepath.Join(app.root, "index.html")
			info, statErr = os.Stat(fullPath)
		}
	}
	if statErr != nil || info.IsDir() {
		http.NotFound(response, request)
		return
	}

	file, err := os.Open(fullPath)
	if err != nil {
		http.NotFound(response, request)
		return
	}
	defer file.Close()
	response.Header().Set("Content-Type", contentType(fullPath))
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(response, request, info.Name(), info.ModTime(), file)
}

func openBrowser(address string) {
	if runtime.GOOS != "windows" {
		return
	}
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			if exec.Command(candidate, address).Start() == nil {
				return
			}
		}
	}
	_ = exec.Command("cmd", "/c", "start", "", address).Start()
}

func resetAdministrator(statePath string) error {
	state, initialized, err := readState(statePath)
	if err != nil {
		return err
	}
	if !initialized {
		state = diskState{Format: 1, Entries: map[string]string{}}
	}
	delete(state.Entries, "lokus-admin-credentials-v1")
	if err := writeState(statePath, state); err != nil {
		return err
	}
	fmt.Println("Administrator access was reset.")
	fmt.Println("Map points, vehicles, routes and settings were preserved.")
	fmt.Println("Start DUS and create a new administrator PIN.")
	return nil
}

func main() {
	defaultRoot, defaultState := executableDefaults()
	rootFlag := flag.String("root", defaultRoot, "path to the offline-site folder")
	stateFlag := flag.String("data", defaultState, "path to dus-data.json")
	portFlag := flag.Int("port", defaultPort, "first local port")
	noBrowserFlag := flag.Bool("no-browser", false, "do not open the browser")
	resetFlag := flag.Bool("reset-admin", false, "reset administrator credentials and exit")
	versionFlag := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Println(serverVersion)
		return
	}
	statePath, err := filepath.Abs(*stateFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Invalid data path:", err)
		os.Exit(1)
	}
	if *resetFlag {
		if err := resetAdministrator(statePath); err != nil {
			fmt.Fprintln(os.Stderr, "Reset failed:", err)
			os.Exit(1)
		}
		return
	}

	root, err := filepath.Abs(*rootFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Invalid site path:", err)
		os.Exit(1)
	}
	if info, err := os.Stat(filepath.Join(root, "index.html")); err != nil || info.IsDir() {
		fmt.Fprintln(os.Stderr, "DUS site files were not found:", root)
		os.Exit(1)
	}

	app := &application{root: root, statePath: statePath}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/dus-storage", app.storageHandler)
	mux.HandleFunc("/api/health", func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, map[string]string{"status": "ok", "version": serverVersion})
	})
	mux.HandleFunc("/", app.staticHandler)

	var listener net.Listener
	activePort := *portFlag
	for candidate := *portFlag; candidate < *portFlag+10; candidate++ {
		listener, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", candidate))
		if err == nil {
			activePort = candidate
			break
		}
	}
	if listener == nil {
		fmt.Fprintf(os.Stderr, "Ports %d-%d are busy.\n", *portFlag, *portFlag+9)
		os.Exit(1)
	}

	address := fmt.Sprintf("http://127.0.0.1:%d/", activePort)
	fmt.Println()
	fmt.Println("============================================================")
	fmt.Println("                    Д У С")
	fmt.Println("              ЛОКАЛЬНАЯ КАРТА")
	fmt.Println("============================================================")
	fmt.Println("Сайт:", address)
	fmt.Println("Данные:", statePath)
	fmt.Println("Для остановки нажмите Ctrl+C.")
	fmt.Println()
	if !*noBrowserFlag {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openBrowser(address)
		}()
	}

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       35 * time.Second,
		WriteTimeout:      35 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		if !errors.Is(err, io.EOF) {
			fmt.Fprintln(os.Stderr, "Server error:", err)
			os.Exit(1)
		}
	}
}
