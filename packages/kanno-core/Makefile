include $(TOPDIR)/rules.mk

PKG_NAME:=kanno-core
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/kanno-core
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  TITLE:=KannoProxy Core
  DEPENDS:=+curl +jsonfilter +nftables +kmod-nft-tproxy +ip-full +ca-bundle
  PKGARCH:=all
endef

define Package/kanno-core/description
  Core scripts for KannoProxy transparent proxy plugin.
  Supports mihomo and sing-box kernels.
endef

define Build/Prepare
endef

define Build/Compile
endef

define Package/kanno-core/install
  $(INSTALL_DIR) $(1)/usr/bin
  $(INSTALL_DIR) $(1)/usr/lib/kanno
  $(INSTALL_DIR) $(1)/etc/init.d
  $(INSTALL_DIR) $(1)/etc/config

  $(INSTALL_BIN) ./root/usr/bin/kanno $(1)/usr/bin/
  $(INSTALL_BIN) ./root/usr/lib/kanno/common.sh     $(1)/usr/lib/kanno/
  $(INSTALL_BIN) ./root/usr/lib/kanno/uri_parser.sh $(1)/usr/lib/kanno/
  $(INSTALL_BIN) ./root/usr/lib/kanno/gen_mihomo.sh $(1)/usr/lib/kanno/
  $(INSTALL_BIN) ./root/usr/lib/kanno/gen_singbox.sh $(1)/usr/lib/kanno/
  $(INSTALL_BIN) ./root/usr/lib/kanno/nftables.sh   $(1)/usr/lib/kanno/
  $(INSTALL_BIN) ./root/usr/lib/kanno/dns.sh        $(1)/usr/lib/kanno/
  $(INSTALL_BIN) ./root/usr/lib/kanno/updater.sh    $(1)/usr/lib/kanno/

  $(INSTALL_BIN)  ./root/etc/init.d/kanno $(1)/etc/init.d/
  $(INSTALL_CONF) ./root/etc/config/kanno $(1)/etc/config/
endef

define Package/kanno-core/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
/etc/init.d/kanno enable
exit 0
endef

define Package/kanno-core/prerm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
/etc/init.d/kanno stop
/etc/init.d/kanno disable
exit 0
endef

$(eval $(call BuildPackage,kanno-core))
