import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../state/session";
import { useSync } from "../../state/sync";
import { getShift, listSales, type LocalSale, type LocalShift } from "./shift";

/** The signed-in cashier's current shift and this till's recent sales, read from local storage. */
export function useShift() {
  const { caps } = useSession();
  const { storage, queue } = useSync();
  const userId = caps?.user.id;
  const [shift, setShift] = useState<LocalShift | undefined>();
  const [sales, setSales] = useState<LocalSale[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) return;
    setShift(await getShift(storage, userId));
    setSales(await listSales(storage, userId));
    setLoaded(true);
  }, [storage, userId]);
  // Re-read when the queue changes: a sync updates the invoice number and synced flag.
  useEffect(() => { void reload(); }, [reload, queue]);
  return { shift, sales, loaded, reload };
}
