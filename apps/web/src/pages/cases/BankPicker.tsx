import * as React from 'react';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { referenceApi } from '@/api/endpoints';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BANK_TYPE_OPTIONS } from './sections';

interface Bank {
  id: string;
  name: string;
  branchName: string;
  ifsc: string | null;
  city: string | null;
}

export interface NewBank {
  name: string;
  branchName: string;
  ifsc?: string;
  bankType?: string;
}

/**
 * Bank + branch selection.
 *
 * We deliberately ship no branch directory — a stale IFSC list is worse than
 * none — so a firm adds the branches it actually deals with, and those rows
 * stay private to that firm until curated.
 */
export function BankPicker({
  value,
  pendingBank,
  onSelect,
  onCreate,
  disabled,
}: {
  value: string;
  pendingBank: NewBank | null;
  onSelect: (bankId: string) => void;
  onCreate: (bank: NewBank) => void;
  disabled?: boolean;
}) {
  const [banks, setBanks] = React.useState<Bank[]>([]);
  const [names, setNames] = React.useState<string[]>([]);
  const [open, setOpen] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => {
    void referenceApi.banks().then(setBanks).catch(() => undefined);
    void referenceApi.bankNames().then(setNames).catch(() => undefined);
  }, []);

  const selected = banks.find((b) => b.id === value);
  const label = pendingBank
    ? `${pendingBank.name} — ${pendingBank.branchName}`
    : selected
      ? `${selected.name} — ${selected.branchName}`
      : 'Select the financing bank…';

  return (
    <div className="space-y-2">
      <Label>
        Financing bank &amp; branch
        <span className="text-destructive"> *</span>
      </Label>

      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className={cn(
                'min-w-0 flex-1 justify-between font-normal',
                !selected && !pendingBank && 'text-muted-foreground',
              )}
            >
              <span className="truncate">{label}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search bank or branch…" />
              <CommandList>
                <CommandEmpty>
                  <div className="py-4 text-center text-sm">
                    <p className="text-muted-foreground">No branch on file.</p>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => {
                        setOpen(false);
                        setAdding(true);
                      }}
                    >
                      Add a branch
                    </Button>
                  </div>
                </CommandEmpty>
                <CommandGroup>
                  {banks.map((b) => (
                    <CommandItem
                      key={b.id}
                      value={`${b.name} ${b.branchName} ${b.ifsc ?? ''}`}
                      onSelect={() => {
                        onSelect(b.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          b.id === value ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <div className="min-w-0">
                        <div className="truncate">
                          {b.name} — {b.branchName}
                        </div>
                        {b.ifsc && (
                          <div className="truncate text-xs text-muted-foreground">{b.ifsc}</div>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Button type="button" variant="outline" disabled={disabled} onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add branch
        </Button>
      </div>

      {pendingBank && (
        <Alert variant="info">
          <Building2 className="h-4 w-4" />
          <AlertDescription>
            {pendingBank.name} — {pendingBank.branchName} will be created when you save this
            section.
          </AlertDescription>
        </Alert>
      )}

      {adding && (
        <AddBranchDialog
          names={names}
          onClose={() => setAdding(false)}
          onCreate={(b) => {
            onCreate(b);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function AddBranchDialog({
  names,
  onClose,
  onCreate,
}: {
  names: string[];
  onClose: () => void;
  onCreate: (bank: NewBank) => void;
}) {
  const [draft, setDraft] = React.useState<NewBank>({ name: '', branchName: '' });
  const [ifscError, setIfscError] = React.useState<string | null>(null);

  const submit = () => {
    if (draft.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(draft.ifsc)) {
      setIfscError('IFSC is 4 letters, a zero, then 6 characters');
      return;
    }
    const bank: NewBank = { name: draft.name.trim(), branchName: draft.branchName.trim() };
    if (draft.ifsc) bank.ifsc = draft.ifsc;
    if (draft.bankType) bank.bankType = draft.bankType;
    onCreate(bank);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a bank branch</DialogTitle>
          <DialogDescription>
            This branch stays private to your firm until it is curated into the shared list.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bank-name">Bank name</Label>
            <Input
              id="bank-name"
              list="bank-name-list"
              value={draft.name}
              autoFocus
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Start typing…"
            />
            <datalist id="bank-name-list">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <Label htmlFor="branch-name">Branch name</Label>
            <Input
              id="branch-name"
              value={draft.branchName}
              onChange={(e) => setDraft({ ...draft, branchName: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ifsc">IFSC</Label>
              <Input
                id="ifsc"
                value={draft.ifsc ?? ''}
                maxLength={11}
                className="uppercase"
                onChange={(e) => {
                  setIfscError(null);
                  setDraft({ ...draft, ifsc: e.target.value.toUpperCase() });
                }}
              />
              {ifscError && <p className="text-xs text-destructive">{ifscError}</p>}
            </div>

            <div className="space-y-2">
              <Label>Bank type</Label>
              <Select
                value={draft.bankType ?? ''}
                onValueChange={(v) => setDraft({ ...draft, bankType: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {BANK_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!draft.name.trim() || !draft.branchName.trim()}>
            Use this bank
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
