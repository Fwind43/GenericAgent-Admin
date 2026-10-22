package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"genericagent-admin-go/internal/config"
)

type oneShotBTWWorkerObserver struct {
	Started  func(*chatWorker) bool
	Finished func(*chatWorker)
}

const oneShotBTWWorkerObserverKey = "_ga_one_shot_worker_observer"

func runOneShotBTWWorker(cfg config.AppConfig, sid string, req map[string]interface{}) (chatMessage, error) {
	observer, _ := req[oneShotBTWWorkerObserverKey].(*oneShotBTWWorkerObserver)
	workerReq := req
	if observer != nil {
		workerReq = make(map[string]interface{}, len(req)-1)
		for key, value := range req {
			if key != oneShotBTWWorkerObserverKey {
				workerReq[key] = value
			}
		}
	}
	worker, err := startChatWorker(cfg, sid+"-btw")
	if err != nil {
		return chatMessage{}, err
	}
	waited := false
	defer func() {
		if observer != nil && observer.Finished != nil {
			observer.Finished(worker)
		}
		_ = worker.Stdin.Close()
		if !waited && worker.Cmd != nil && worker.Cmd.Process != nil {
			_ = worker.Cmd.Process.Kill()
			_, _ = worker.Cmd.Process.Wait()
		}
	}()
	if observer != nil && observer.Started != nil && !observer.Started(worker) {
		return chatMessage{}, errChatLoopStale
	}
	if err := json.NewEncoder(worker.Stdin).Encode(workerReq); err != nil {
		return chatMessage{}, err
	}
	reader := bufio.NewReaderSize(worker.Stdout, 64*1024)
	for {
		line, readErr := readChatWorkerLine(reader)
		line = bytes.TrimSpace(line)
		if len(line) > 0 {
			var ev map[string]interface{}
			if err := json.Unmarshal(line, &ev); err == nil {
				typ, _ := ev["type"].(string)
				if typ == "btw_done" {
					data, err := json.Marshal(ev["message"])
					if err != nil {
						return chatMessage{}, err
					}
					var msg chatMessage
					if err := json.Unmarshal(data, &msg); err != nil {
						return chatMessage{}, err
					}
					if strings.TrimSpace(msg.Content) == "" {
						return chatMessage{}, fmt.Errorf("btw worker returned empty response")
					}
					_ = worker.Stdin.Close()
					waitErr := worker.Cmd.Wait()
					waited = true
					if waitErr != nil {
						return chatMessage{}, waitErr
					}
					return msg, nil
				}
				if typ == "error" {
					data, _ := json.Marshal(ev["message"])
					var msg chatMessage
					_ = json.Unmarshal(data, &msg)
					if strings.TrimSpace(msg.Content) != "" {
						return chatMessage{}, fmt.Errorf("%s", msg.Content)
					}
					return chatMessage{}, fmt.Errorf("btw worker failed")
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				return chatMessage{}, fmt.Errorf("btw worker exited before response")
			}
			return chatMessage{}, readErr
		}
	}
}

var runOneShotBTWWorkerFunc = runOneShotBTWWorker

func runOneShotChatTitleWorker(cfg config.AppConfig, sid string, req map[string]interface{}) (string, error) {
	worker, err := startChatWorker(cfg, sid+"-title")
	if err != nil {
		return "", err
	}
	waited := false
	timeout := time.AfterFunc(2*time.Minute, func() {
		if worker.Cmd != nil && worker.Cmd.Process != nil {
			_ = worker.Cmd.Process.Kill()
		}
	})
	defer func() {
		timeout.Stop()
		_ = worker.Stdin.Close()
		if !waited && worker.Cmd != nil && worker.Cmd.Process != nil {
			_ = worker.Cmd.Process.Kill()
			_, _ = worker.Cmd.Process.Wait()
		}
	}()
	if err := json.NewEncoder(worker.Stdin).Encode(req); err != nil {
		return "", err
	}
	reader := bufio.NewReaderSize(worker.Stdout, 64*1024)
	for {
		line, readErr := readChatWorkerLine(reader)
		line = bytes.TrimSpace(line)
		if len(line) > 0 {
			var ev map[string]interface{}
			if err := json.Unmarshal(line, &ev); err == nil {
				typ, _ := ev["type"].(string)
				if typ == "title_done" {
					title, _ := ev["title"].(string)
					title = sanitizeGeneratedChatTitle(title)
					if title == "" {
						return "", fmt.Errorf("title worker returned empty response")
					}
					_ = worker.Stdin.Close()
					waitErr := worker.Cmd.Wait()
					waited = true
					if waitErr != nil {
						return "", waitErr
					}
					return title, nil
				}
				if typ == "error" {
					data, _ := json.Marshal(ev["message"])
					var msg chatMessage
					_ = json.Unmarshal(data, &msg)
					if strings.TrimSpace(msg.Content) != "" {
						return "", fmt.Errorf("%s", msg.Content)
					}
					return "", fmt.Errorf("title worker failed")
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				return "", fmt.Errorf("title worker exited before response")
			}
			return "", readErr
		}
	}
}

var runOneShotChatTitleWorkerFunc = runOneShotChatTitleWorker
