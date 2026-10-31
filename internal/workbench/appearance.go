package workbench

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

type AppearanceFonts struct {
	UI   string `json:"ui" toml:"ui"`
	Code string `json:"code" toml:"code"`
}
type AppearanceTheme struct {
	Preset        string          `json:"preset"`
	Accent        string          `json:"accent" toml:"accent"`
	Surface       string          `json:"surface" toml:"surface"`
	Ink           string          `json:"ink" toml:"ink"`
	Contrast      int             `json:"contrast" toml:"contrast"`
	OpaqueWindows bool            `json:"opaqueWindows" toml:"opaqueWindows"`
	Fonts         AppearanceFonts `json:"fonts" toml:"fonts"`
}
type Appearance struct {
	Mode           string          `json:"mode"`
	Light          AppearanceTheme `json:"lightTheme"`
	Dark           AppearanceTheme `json:"darkTheme"`
	UIFontSize     int             `json:"uiFontSize"`
	CodeFontSize   int             `json:"codeFontSize"`
	PointerCursors bool            `json:"pointerCursors"`
	FontSmoothing  bool            `json:"fontSmoothing"`
	ReducedMotion  string          `json:"reducedMotion"`
}

func defaultAppearance() Appearance {
	return Appearance{Mode: "system", Light: AppearanceTheme{Preset: "codex", Accent: "#339cff", Surface: "#ffffff", Ink: "#1a1c1f", Contrast: 45}, Dark: AppearanceTheme{Preset: "codex", Accent: "#339cff", Surface: "#181818", Ink: "#ffffff", Contrast: 60}, UIFontSize: 14, CodeFontSize: 13, FontSmoothing: true, ReducedMotion: "system"}
}

func (a Appearance) validate() error {
	if a.Mode != "system" && a.Mode != "light" && a.Mode != "dark" {
		return errors.New("请选择跟随系统、浅色或深色外观")
	}
	if a.UIFontSize < 12 || a.UIFontSize > 24 || a.CodeFontSize < 10 || a.CodeFontSize > 24 {
		return errors.New("界面字号范围为 12–24，代码字号范围为 10–24")
	}
	if a.ReducedMotion != "system" && a.ReducedMotion != "on" && a.ReducedMotion != "off" {
		return errors.New("减少动态效果选项无效")
	}
	color := regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	for _, theme := range []AppearanceTheme{a.Light, a.Dark} {
		if !color.MatchString(theme.Accent) || !color.MatchString(theme.Surface) || !color.MatchString(theme.Ink) {
			return errors.New("颜色须为六位十六进制值，例如 #fdf6e3")
		}
		if theme.Contrast < 0 || theme.Contrast > 100 {
			return errors.New("对比度范围为 0–100")
		}
		if len(theme.Preset) > 80 {
			return errors.New("主题名称过长")
		}
		for _, font := range []string{theme.Fonts.UI, theme.Fonts.Code} {
			if len(font) > 200 || strings.ContainsAny(font, ";{}<>\r\n") {
				return errors.New("字体名称无效")
			}
		}
	}
	return nil
}

func (s *Server) getAppearance(w http.ResponseWriter, r *http.Request) {
	a := defaultAppearance()
	b, err := os.ReadFile(filepath.Join(s.profile, "appearance.json"))
	if err == nil {
		err = json.Unmarshal(b, &a)
	}
	if err != nil && !os.IsNotExist(err) {
		requestError(w, errors.New("无法读取已保存的外观设置"))
		return
	}
	if err = a.validate(); err != nil {
		requestError(w, err)
		return
	}
	jsonReply(w, a)
}

func (s *Server) saveAppearance(w http.ResponseWriter, r *http.Request) {
	var a Appearance
	if !readJSON(w, r, &a) {
		return
	}
	if err := a.validate(); err != nil {
		requestError(w, err)
		return
	}
	// Appearance has no VM or network side effects and uses its own atomic file.
	if err := writePrivate(filepath.Join(s.profile, "appearance.json"), a); err != nil {
		requestError(w, errors.New("外观设置未能保存，请重试"))
		return
	}
	jsonReply(w, a)
}

func readCodexAppearance(configPath string) (Appearance, error) {
	a := defaultAppearance()
	a.CodeFontSize = 12
	var config struct {
		Desktop struct {
			Mode           string           `toml:"appearanceTheme"`
			Light          *AppearanceTheme `toml:"appearanceLightChromeTheme"`
			Dark           *AppearanceTheme `toml:"appearanceDarkChromeTheme"`
			LightPreset    string           `toml:"appearanceLightCodeThemeId"`
			DarkPreset     string           `toml:"appearanceDarkCodeThemeId"`
			UIFontSize     int              `toml:"sansFontSize"`
			CodeFontSize   int              `toml:"codeFontSize"`
			PointerCursors bool             `toml:"usePointerCursors"`
			FontSmoothing  *bool            `toml:"useFontSmoothing"`
		} `toml:"desktop"`
	}
	b, err := os.ReadFile(configPath)
	if err != nil {
		return a, errors.New("未找到本机 Codex 配置")
	}
	if err = toml.Unmarshal(b, &config); err != nil {
		return a, errors.New("无法解析本机 Codex 配置")
	}
	d := config.Desktop
	if d.Mode != "" {
		a.Mode = d.Mode
	}
	if d.Light != nil {
		a.Light = *d.Light
	}
	if d.Dark != nil {
		a.Dark = *d.Dark
	}
	a.Light.Preset = d.LightPreset
	if a.Light.Preset == "" {
		a.Light.Preset = "codex"
	}
	a.Dark.Preset = d.DarkPreset
	if a.Dark.Preset == "" {
		a.Dark.Preset = "codex"
	}
	if d.UIFontSize != 0 {
		a.UIFontSize = d.UIFontSize
	}
	if d.CodeFontSize != 0 {
		a.CodeFontSize = d.CodeFontSize
	}
	a.PointerCursors = d.PointerCursors
	if d.FontSmoothing != nil {
		a.FontSmoothing = *d.FontSmoothing
	}
	// This preference is stored separately by Codex; no other state is returned.
	var global struct {
		ReducedMotion string `json:"reduced-motion-preference"`
	}
	if b, err := os.ReadFile(filepath.Join(filepath.Dir(configPath), ".codex-global-state.json")); err == nil && json.Unmarshal(b, &global) == nil && global.ReducedMotion != "" {
		a.ReducedMotion = global.ReducedMotion
	}
	return a, a.validate()
}

func (s *Server) codexAppearance(w http.ResponseWriter, r *http.Request) {
	home, err := os.UserHomeDir()
	if err != nil {
		requestError(w, errors.New("无法定位本机用户目录"))
		return
	}
	a, err := readCodexAppearance(filepath.Join(home, ".codex", "config.toml"))
	if err != nil {
		requestError(w, err)
		return
	}
	jsonReply(w, a)
}
