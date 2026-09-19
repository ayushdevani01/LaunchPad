//go:build windows

package repository

import (
	"os/exec"
	"strconv"
)

func configureProcess(c *exec.Cmd) {
	c.Cancel = func() error { return exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(c.Process.Pid)).Run() }
}
func shell(s string) (string, []string) { return "cmd.exe", []string{"/d", "/s", "/c", s} }
