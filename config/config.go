package config

import (
	"os"
	"strings"
)

type Config struct {
	DatabaseURL string
	JWTSecret   string
	StunServers []string
	Port        string
}

func Load() *Config {
	return &Config{
		DatabaseURL: getEnv("DATABASE_URL", "postgres://localhost/radiance"),
		JWTSecret:   getEnv("JWT_SECRET", "dev-secret-key-change-in-prod"),
		StunServers: parseStunServers(getEnv("STUN_SERVERS", "stun:stun.l.google.com:19302")),
		Port:        getEnv("PORT", "8080"),
	}
}

func getEnv(key, defaultVal string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultVal
}

func parseStunServers(input string) []string {
	servers := strings.Split(input, ",")
	for i, s := range servers {
		servers[i] = strings.TrimSpace(s)
	}
	return servers
}
