// cregis-readonly verifies one page of project history without printing records,
// addresses or secrets. It performs no database or financial writes.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"moventra.local/api/internal/cregis"
)

func main() {
	c, e := cregis.FromEnv()
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancel()
	coins, e := c.Coins(ctx)
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	p, e := c.ListTrades(ctx, cregis.TradeQuery{Page: 1, PageSize: 20})
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	if e = json.NewEncoder(os.Stdout).Encode(map[string]any{"provider": "cregis_waas", "addressAssetCount": len(coins.Address), "payoutAssetCount": len(coins.Payout), "page": p.Page, "pageSize": p.PageSize, "total": p.Total.String(), "received": len(p.Rows), "scope": "project_history_page"}); e != nil {
		os.Exit(1)
	}
}
