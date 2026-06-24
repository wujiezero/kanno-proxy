include $(TOPDIR)/rules.mk

PKG_NAME:=tomfly-core
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/tomfly-core
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  TITLE:=TomFly Core
  DEPENDS:=+curl +jsonfilter +nftables +kmod-nft-tproxy +ip-full +ca-bundle
  PKGARCH:=all
endef

define Package/tomfly-core/description
  Core scripts for TomFly transparent proxy plugin.
  Supports mihomo and sing-box kernels.
endef

define Build/Prepare
endef

define Build/Compile
endef

define Package/tomfly-core/install
  $(INSTALL_DIR) $(1)/usr/bin
  $(INSTALL_DIR) $(1)/usr/lib/tomfly
  $(INSTALL_DIR) $(1)/etc/init.d
  $(INSTALL_DIR) $(1)/etc/config

  $(INSTALL_BIN) ./root/usr/bin/tomfly $(1)/usr/bin/
  $(INSTALL_BIN) ./root/usr/lib/tomfly/common.sh     $(1)/usr/lib/tomfly/
  $(INSTALL_BIN) ./root/usr/lib/tomfly/uri_parser.sh $(1)/usr/lib/tomfly/
  $(INSTALL_BIN) ./root/usr/lib/tomfly/gen_mihomo.sh $(1)/usr/lib/tomfly/
  $(INSTALL_BIN) ./root/usr/lib/tomfly/gen_singbox.sh $(1)/usr/lib/tomfly/
  $(INSTALL_BIN) ./root/usr/lib/tomfly/nftables.sh   $(1)/usr/lib/tomfly/
  $(INSTALL_BIN) ./root/usr/lib/tomfly/dns.sh        $(1)/usr/lib/tomfly/
  $(INSTALL_BIN) ./root/usr/lib/tomfly/traffic.sh    $(1)/usr/lib/tomfly/
  $(INSTALL_BIN) ./root/usr/lib/tomfly/updater.sh    $(1)/usr/lib/tomfly/

  $(INSTALL_BIN)  ./root/etc/init.d/tomfly $(1)/etc/init.d/
  $(INSTALL_CONF) ./root/etc/config/tomfly $(1)/etc/config/
endef

define Package/tomfly-core/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
/etc/init.d/tomfly enable
exit 0
endef

define Package/tomfly-core/prerm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
/etc/init.d/tomfly stop
/etc/init.d/tomfly disable
exit 0
endef

$(eval $(call BuildPackage,tomfly-core))
