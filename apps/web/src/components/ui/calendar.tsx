import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DropdownProps } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Month/year dropdowns.
 *
 * react-day-picker's own caption dropdowns are bare <select>s, which look
 * nothing like the rest of the app. That matters more than usual here: a lot
 * of the dates a CA enters (incorporation, first commercial sale) are years in
 * the past, and clicking a chevron forty times is not a date picker.
 */
function CaptionDropdown({ value, onChange, children }: DropdownProps) {
  const options = React.Children.toArray(children) as React.ReactElement<
    React.HTMLProps<HTMLOptionElement>
  >[];
  const selected = options.find((c) => c.props.value === value);

  return (
    <Select
      value={value?.toString()}
      onValueChange={(v) => {
        onChange?.({ target: { value: v } } as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectTrigger className="h-7 w-auto gap-1 border-none px-2 text-sm font-medium focus:ring-0 focus:ring-offset-0">
        <SelectValue>{selected?.props?.children}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-64">
        {options.map((option, i) => (
          <SelectItem key={`${option.props.value}-${i}`} value={option.props.value!.toString()}>
            {option.props.children}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-2',
        month: 'flex flex-col gap-4',
        caption: 'flex justify-center pt-1 relative items-center gap-1',
        caption_label: 'text-sm font-medium',
        caption_dropdowns: 'flex items-center gap-1',
        nav: 'flex items-center gap-1',
        nav_button: cn(
          buttonVariants({ variant: 'outline' }),
          'h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100',
        ),
        nav_button_previous: 'absolute left-1',
        nav_button_next: 'absolute right-1',
        table: 'w-full border-collapse space-x-1',
        head_row: 'flex',
        head_cell: 'text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]',
        row: 'flex w-full mt-2',
        cell: cn(
          'relative p-0 text-center text-sm focus-within:relative focus-within:z-20',
          '[&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50',
          '[&:has([aria-selected].day-range-end)]:rounded-r-md',
          '[&:has(>.day-range-start)]:rounded-l-md [&:has(>.day-range-end)]:rounded-r-md',
        ),
        day: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-8 w-8 p-0 font-normal tabular-nums aria-selected:opacity-100',
        ),
        day_range_start: 'day-range-start',
        day_range_end: 'day-range-end',
        day_selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        day_today: 'bg-accent text-accent-foreground font-semibold',
        day_outside: 'day-outside text-muted-foreground/50 aria-selected:text-muted-foreground',
        day_disabled: 'text-muted-foreground/40 line-through',
        day_range_middle: 'aria-selected:bg-accent aria-selected:text-accent-foreground',
        day_hidden: 'invisible',
        ...classNames,
      }}
      components={{
        IconLeft: ({ className: c, ...p }) => <ChevronLeft className={cn('h-4 w-4', c)} {...p} />,
        IconRight: ({ className: c, ...p }) => <ChevronRight className={cn('h-4 w-4', c)} {...p} />,
        Dropdown: CaptionDropdown,
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
