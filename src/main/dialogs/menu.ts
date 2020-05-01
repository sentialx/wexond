import { BrowserWindow } from 'electron';
import { Application } from '../application';
import { DIALOG_MARGIN_TOP, DIALOG_MARGIN } from '~/constants/design';

export const showMenuDialog = (
  browserWindow: BrowserWindow,
  x: number,
  y: number,
) => {
  const menuWidth = 330;
  Application.instance.dialogs.show({
    name: 'menu',
    browserWindow,
    bounds: {
      width: menuWidth,
      height: 470,
      x: x - menuWidth + DIALOG_MARGIN,
      y: y - DIALOG_MARGIN_TOP,
    },
  });
};
